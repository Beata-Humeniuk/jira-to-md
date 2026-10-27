const vscode = require('vscode');
const { withNotification } = require('./progress');
const { mdToWiki } = require('./mdToWiki');
const { mdToHtml } = require('./mdToHtml');
const { looksLikeHtml } = require('./htmlToMd');
const { parseFrontMatter, serializeFrontMatter } = require('./frontMatter');
const {
  parseJiraUrl, isCloud, issueWebUrl, fetchIssue, createIssue, updateIssue, uploadAttachment, downloadAttachment
} = require('./jiraClient');
const { localTargets } = require('./attachments');
const { contextAndIssue } = require('./issues');
const { credentialsFor } = require('./credentials');
const { errorMessage } = require('./messages');
const { descriptionFormat } = require('./config');

const ISSUE_TYPES = ['Story', 'Task'];

function baseName(path) {
  return String(path || '').split(/[\\/]/).pop() || '';
}

function splitTitleAndBody(mdBody, fallbackTitle) {
  const h1 = mdBody.match(/^#[ \t]+(.+)\r?\n?/m);
  if (!h1) return { title: fallbackTitle, content: mdBody };
  return { title: h1[1].trim(), content: mdBody.replace(h1[0], '') };
}

// Jira fields edited in a rich-text editor store HTML. Wiki markup sent there gets an
// <a name> anchor per heading, which the editor shows as a flag, so such fields get HTML.
function descriptionFor(content, sample, links) {
  const format = descriptionFormat();
  const html = format === 'auto' ? looksLikeHtml(sample) : format === 'html';
  return html ? mdToHtml(content, links) : mdToWiki(content, links);
}

async function readLocalFile(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory) return null;
    return Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch (e) {
    return null;
  }
}

// A description can come from Jira, so only files inside the workspace folder are sent, and no
// hidden ones (.env, .ssh/…).
function attachableUri(source, path) {
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s[0] === '.' && s !== '.' && s !== '..')) return null;
  const folder = vscode.Uri.joinPath(source.uri, '..');
  const workspace = vscode.workspace.getWorkspaceFolder(source.uri);
  const root = (workspace ? workspace.uri : folder).path.replace(/\/+$/, '') + '/';
  const uri = vscode.Uri.joinPath(folder, ...segments);
  return uri.path.startsWith(root) ? uri : null;
}

// Files the description links to (./config.ts) go to Jira as attachments of the issue, so the
// links still lead somewhere there. An attachment with the same name and content is reused.
async function attachLinkedFiles(creds, site, key, source, content) {
  const files = [];
  for (const target of localTargets(content)) {
    const uri = attachableUri(source, target.path);
    const bytes = uri && await readLocalFile(uri);
    if (bytes) files.push({ ...target, bytes });
  }
  if (!files.length) return { links: undefined, uploaded: [] };

  const attachments = (await fetchIssue(creds, site, key, ['attachment'])).fields.attachment || [];
  const links = {};
  const uploaded = [];
  for (const file of files) {
    let attachment = null;
    for (const a of attachments) {
      if (a.filename !== file.name || Number(a.size) !== file.bytes.length) continue;
      if ((await downloadAttachment(creds, a.content)).equals(file.bytes)) {
        attachment = a;
        break;
      }
    }
    if (!attachment) {
      attachment = await uploadAttachment(creds, site, key, file.name, file.bytes);
      attachments.unshift(attachment);
      uploaded.push(file.name);
    }
    links[file.href] = { url: attachment.content, filename: attachment.filename };
  }
  return { links, uploaded };
}

function attachedNote(uploaded) {
  return uploaded.length ? ' Attached ' + uploaded.join(', ') + '.' : '';
}

function editorSource(editor) {
  return {
    uri: editor.document.uri,
    text: editor.document.getText(),
    fileName: baseName(editor.document.fileName),
    editor
  };
}

async function uriSource(uri) {
  return {
    uri,
    text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),
    fileName: baseName(uri.fsPath || uri.path),
    editor: null
  };
}

async function writeBinding(source, meta) {
  const text = source.editor ? source.editor.document.getText() : source.text;
  const { rawLength, extraLines } = parseFrontMatter(text);
  const fm = serializeFrontMatter(meta, extraLines) + (rawLength ? '' : '\n');
  if (!source.editor) {
    await vscode.workspace.fs.writeFile(source.uri, Buffer.from(fm + text.slice(rawLength), 'utf8'));
    return;
  }
  const document = source.editor.document;
  await source.editor.edit((edit) => {
    edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(rawLength)), fm);
  });
}

async function publishUpdate(source, meta, title, content) {
  const parsed = parseJiraUrl(meta.url);
  if (!parsed || !parsed.issueKey) throw new Error('bad-url');
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { issue: current } = await withNotification('Checking ' + parsed.issueKey + ' in Jira…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (meta.updated && current.updated !== meta.updated) {
    const overwrite = 'Overwrite';
    const picked = await vscode.window.showWarningMessage(
      current.key + ' has changed in Jira (' + current.updated + ', your local copy is from ' + meta.updated + '). Overwrite?',
      { modal: true }, overwrite);
    if (picked !== overwrite) return;
  }

  const { updated, uploaded } = await withNotification('Pushing ' + current.key + ' to Jira…', async () => {
    const { links, uploaded: names } = await attachLinkedFiles(creds, parsed.site, current.key, source, content);
    const description = descriptionFor(content, current.fields.description, links);
    await updateIssue(creds, parsed.site, current.key, { fields: { summary: title, description } });
    return { updated: await fetchIssue(creds, parsed.site, current.key, ['updated']), uploaded: names };
  });

  await writeBinding(source, { url: meta.url, updated: updated.fields.updated });
  vscode.window.showInformationMessage('Pushed ' + current.key + ' "' + title + '".' + attachedNote(uploaded));
  return { url: meta.url, key: current.key, action: 'updated' };
}

async function askForParent() {
  const parentUrl = await vscode.window.showInputBox({
    prompt: 'New issue — paste a link to the epic it belongs to, or to the project',
    placeHolder: 'https://…/browse/PROJ-1',
    ignoreFocusOut: true
  });
  if (!parentUrl) return null;
  const parsed = parseJiraUrl(parentUrl);
  if (!parsed) throw new Error('bad-parent');
  return parsed;
}

async function publishNew(source, title, content) {
  const parsed = await askForParent();
  if (!parsed) return;
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { ctx, issue: epic } = await withNotification('Checking the parent in Jira…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (epic && !epic.isEpic) throw new Error('bad-parent');

  const type = await vscode.window.showQuickPick(ISSUE_TYPES,
    { placeHolder: 'Issue type for "' + title + '"', ignoreFocusOut: true });
  if (!type) return;

  const description = descriptionFor(content, epic && epic.fields.description);
  const fields = {
    project: { key: epic ? epic.project : parsed.projectKey },
    issuetype: { name: type },
    summary: title,
    description
  };
  if (epic && ctx.epicLinkId) fields[ctx.epicLinkId] = epic.key;
  else if (epic && isCloud(parsed.site)) fields.parent = { key: epic.key };

  const created = await withNotification('Creating the issue in Jira…', async () => {
    const made = await createIssue(creds, parsed.site, fields);
    // Attachments need the issue, so links to local files are fixed once it exists.
    const { links, uploaded } = await attachLinkedFiles(creds, parsed.site, made.key, source, content);
    if (links) {
      const linked = descriptionFor(content, epic && epic.fields.description, links);
      await updateIssue(creds, parsed.site, made.key, { fields: { description: linked } });
    }
    const fresh = await fetchIssue(creds, parsed.site, made.key, ['updated']);
    return { key: made.key, updated: fresh.fields.updated, uploaded };
  });

  const url = issueWebUrl(parsed.site, created.key);
  await writeBinding(source, { url, updated: created.updated });
  vscode.window.showInformationMessage('Created ' + created.key + ' "' + title + '"' +
    (epic ? ' in epic ' + epic.key : '') + '.' + attachedNote(created.uploaded));
  return { url, key: created.key, action: 'created' };
}

async function publishIssueCommand(fileUri) {
  const editor = fileUri ? null : vscode.window.activeTextEditor;
  if (!fileUri && !editor) {
    vscode.window.showErrorMessage('Open the Markdown file you want to push to Jira.');
    return;
  }

  try {
    const source = fileUri ? await uriSource(fileUri) : editorSource(editor);
    const { meta, body } = parseFrontMatter(source.text);
    const { title, content } = splitTitleAndBody(body, source.fileName.replace(/\.md$/i, '') || 'Untitled');
    return meta
      ? await publishUpdate(source, meta, title, content)
      : await publishNew(source, title, content);
  } catch (e) {
    if (fileUri) throw new Error(errorMessage(e));
    vscode.window.showErrorMessage(errorMessage(e));
  }
}

module.exports = { publishIssueCommand };
