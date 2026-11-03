const vscode = require('vscode');
const { withNotification } = require('./progress');
const { mdToWiki } = require('./mdToWiki');
const { mdToHtml } = require('./mdToHtml');
const { looksLikeHtml } = require('./htmlToMd');
const { parseFrontMatter, serializeFrontMatter } = require('./frontMatter');
const {
  parseJiraUrl, isCloud, issueWebUrl, fetchIssue, createIssue, updateIssue, uploadAttachment, downloadAttachment
} = require('./jiraClient');
const { localTargets, rebaseLinks } = require('./attachments');
const { diagramsIn, withDiagramImages } = require('./mermaidImages');
const { renderDiagrams } = require('./mermaidRenderer');
const { contextAndIssue } = require('./issues');
const { issueFileName } = require('./fileNames');
const { publishedDocument } = require('./issueDocument');
const { readSavedIssues, confirmOverwrite } = require('./savedIssues');
const { credentialsFor } = require('./credentials');
const { errorMessage } = require('./messages');
const { descriptionFormat, packageRootUri } = require('./config');

const ISSUE_TYPES = ['Story', 'Task'];
const REPLACE_DESCRIPTION = 'Replace the description';
const REPLACE_BOTH = 'Replace the description and the summary';

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

// ```mermaid blocks become PNG attachments shown in their place, as Jira draws no Mermaid. A diagram
// is named after its source, so an unchanged one keeps its attachment and is not drawn again.
async function attachDiagrams(creds, site, key, diagrams, attachments, links) {
  const missing = diagrams.filter((d) => !attachments.some((a) => a.filename === d.name));
  const drawn = missing.length ? await renderDiagrams(missing.map((d) => d.source)) : [];
  const failed = [];
  let uploaded = 0;
  for (const diagram of diagrams) {
    let attachment = attachments.find((a) => a.filename === diagram.name);
    if (!attachment) {
      const result = drawn[missing.indexOf(diagram)];
      if (result.error) {
        failed.push(result.error);
        continue;
      }
      attachment = await uploadAttachment(creds, site, key, diagram.name, result.png);
      attachments.unshift(attachment);
      uploaded++;
    }
    links[diagram.name] = { url: attachment.content, filename: attachment.filename };
  }
  return { drawn: uploaded, failed };
}

// Files the description links to (./config.ts) go to Jira as attachments of the issue, so the
// links still lead somewhere there. An attachment with the same name and content is reused.
// content comes back with the drawn diagrams as images.
async function attachLinkedFiles(creds, site, key, source, content) {
  const files = [];
  for (const target of localTargets(content)) {
    const uri = attachableUri(source, target.path);
    const bytes = uri && await readLocalFile(uri);
    if (bytes) files.push({ ...target, bytes });
  }
  const diagrams = diagramsIn(content);
  if (!files.length && !diagrams.length) return { content, links: undefined, uploaded: [], drawn: 0, failed: [] };

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
  const { drawn, failed } = await attachDiagrams(creds, site, key, diagrams, attachments, links);
  const named = new Set(diagrams.map((d) => d.name).filter((name) => links[name]));
  return { content: withDiagramImages(content, named), links, uploaded, drawn, failed };
}

function attachedNote({ uploaded, drawn, failed }) {
  return (uploaded.length ? ' Attached ' + uploaded.join(', ') + '.' : '') +
    (drawn ? ' Drew ' + drawn + (drawn === 1 ? ' diagram.' : ' diagrams.') : '') +
    (failed.length ? ' ' + (failed.length === 1 ? 'A diagram' : failed.length + ' diagrams') +
      ' could not be drawn and went as code: ' + failed.join('; ') + '.' : '');
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

function dirOf(path) {
  return path.split('/').slice(0, -1).join('/');
}

function packageName(issue) {
  return issueFileName(issue.key, issue.summary).replace(/\.md$/, '');
}

// Where Download would put the issue: the file already bound to it, else the folder of its saved
// epic, else a package of its own (or of the epic it was just created in).
function packagePath(issue, epic, saved) {
  const known = new Map(saved.filter((s) => s.key).map((s) => [s.key, s.relPath]));
  if (known.has(issue.key)) return known.get(issue.key);
  const epicPath = issue.epic && known.get(issue.epic);
  const dir = (epicPath && dirOf(epicPath)) || packageName(epic || issue);
  return dir + '/' + issueFileName(issue.key, issue.summary);
}

// A file published from outside the download folder is also saved there, in the issue's package,
// like a download: the issue's file there is refreshed, or a new one made.
async function saveToPackage(source, issue, epic, content) {
  const root = packageRootUri(source.uri);
  if (!root || source.uri.path.startsWith(root.path.replace(/\/+$/, '') + '/')) return null;
  const saved = await readSavedIssues(root);
  const relPath = packagePath(issue, epic, saved);
  const segments = relPath.split('/');
  const uri = vscode.Uri.joinPath(root, ...segments);
  const previous = saved.find((s) => s.relPath === relPath);
  const sameIssue = !!previous && previous.key === issue.key;
  if (!await confirmOverwrite([{ uri, relPath, sameIssue }])) return null;
  const toDir = vscode.Uri.joinPath(root, ...segments.slice(0, -1));
  const markdown = rebaseLinks(content, vscode.Uri.joinPath(source.uri, '..').path, toDir.path);
  await vscode.workspace.fs.createDirectory(toDir);
  await vscode.workspace.fs.writeFile(uri,
    Buffer.from(publishedDocument(issue, markdown, sameIssue ? previous.text : ''), 'utf8'));
  return uri;
}

function savedNote(uri) {
  return uri ? ' Saved to ' + vscode.workspace.asRelativePath(uri, false) + '.' : '';
}

// body is the whole file below the front matter: with the issue's summary kept, the # heading is
// not the summary, so it stays in the description.
async function publishUpdate(source, meta, title, titled, body) {
  const content = meta.keepSummary ? body.replace(/^\s+/, '') : titled;
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

  const summary = meta.keepSummary ? current.summary : title;
  const { updated, attached } = await withNotification('Publishing ' + current.key + ' to Jira…', async () => {
    const files = await attachLinkedFiles(creds, parsed.site, current.key, source, content);
    const description = descriptionFor(files.content, current.fields.description, files.links);
    const fields = meta.keepSummary ? { description } : { summary, description };
    await updateIssue(creds, parsed.site, current.key, { fields });
    return { updated: await fetchIssue(creds, parsed.site, current.key, ['updated']), attached: files };
  });

  await writeBinding(source, Object.assign({}, meta, { updated: updated.fields.updated }));
  const copy = await saveToPackage(source,
    Object.assign({}, current, { summary, updated: updated.fields.updated }), null, content);
  vscode.window.showInformationMessage('Published ' + current.key + ' "' + summary + '".' +
    attachedNote(attached) + savedNote(copy));
  return { url: meta.url, key: current.key, action: 'updated' };
}

async function askForTarget() {
  const targetUrl = await vscode.window.showInputBox({
    prompt: 'Paste a link to the Jira issue whose description this file replaces — ' +
      'or to an epic or a project to create a new issue in',
    placeHolder: 'https://…/browse/PROJ-12',
    ignoreFocusOut: true
  });
  if (!targetUrl) return null;
  const parsed = parseJiraUrl(targetUrl);
  if (!parsed) throw new Error('bad-target');
  return parsed;
}

async function pickEpicAction(epic, title) {
  const create = { label: 'Create a new issue in epic ' + epic.key, description: '"' + title + '"' };
  const replace = { label: 'Replace the description of epic ' + epic.key, description: '"' + epic.summary + '"' };
  const picked = await vscode.window.showQuickPick([create, replace],
    { placeHolder: epic.key + ' is an epic — what should "' + title + '" do?', ignoreFocusOut: true });
  return picked ? (picked === create ? 'create' : 'replace') : null;
}

// Binds the file to an issue that already exists, e.g. one created with an empty description.
async function replaceExisting(source, target, title, content, body) {
  const empty = !target.description.trim();
  const buttons = title === target.summary ? [REPLACE_DESCRIPTION] : [REPLACE_DESCRIPTION, REPLACE_BOTH];
  const picked = await vscode.window.showWarningMessage(
    'Publish this file as the description of ' + target.key + ' "' + target.summary + '"? ' +
    (empty ? 'Its description is empty.' : 'Its current description is replaced.') +
    (buttons.length > 1 ? ' Keep its summary, or replace it with "' + title + '"?' : '') +
    ' The file is bound to the issue, so later publishes update it.',
    { modal: true }, ...buttons);
  if (!picked) return;
  const meta = { url: issueWebUrl(target.site, target.key), updated: target.updated };
  if (picked === REPLACE_DESCRIPTION && buttons.length > 1) meta.keepSummary = true;
  return publishUpdate(source, meta, title, content, body);
}

async function publishNew(source, title, content, body) {
  const parsed = await askForTarget();
  if (!parsed) return;
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { ctx, issue: target } = await withNotification('Checking the issue in Jira…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (target && !target.isEpic) return replaceExisting(source, target, title, content, body);
  if (target) {
    const action = await pickEpicAction(target, title);
    if (!action) return;
    if (action === 'replace') return replaceExisting(source, target, title, content, body);
  }
  const epic = target;

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
    const files = await attachLinkedFiles(creds, parsed.site, made.key, source, content);
    if (files.links) {
      const linked = descriptionFor(files.content, epic && epic.fields.description, files.links);
      await updateIssue(creds, parsed.site, made.key, { fields: { description: linked } });
    }
    const fresh = await fetchIssue(creds, parsed.site, made.key, ['updated']);
    return { key: made.key, updated: fresh.fields.updated, attached: files };
  });

  const url = issueWebUrl(parsed.site, created.key);
  await writeBinding(source, { url, updated: created.updated });
  const copy = await saveToPackage(source, {
    key: created.key, summary: title, type, updated: created.updated, epic: epic ? epic.key : '', site: parsed.site
  }, epic, content);
  vscode.window.showInformationMessage('Created ' + created.key + ' "' + title + '"' +
    (epic ? ' in epic ' + epic.key : '') + '.' + attachedNote(created.attached) + savedNote(copy));
  return { url, key: created.key, action: 'created' };
}

async function publishIssueCommand(fileUri) {
  const editor = fileUri ? null : vscode.window.activeTextEditor;
  if (!fileUri && !editor) {
    vscode.window.showErrorMessage('Open the Markdown file you want to publish to Jira.');
    return;
  }

  try {
    const source = fileUri ? await uriSource(fileUri) : editorSource(editor);
    const { meta, body } = parseFrontMatter(source.text);
    const { title, content } = splitTitleAndBody(body, source.fileName.replace(/\.md$/i, '') || 'Untitled');
    return meta
      ? await publishUpdate(source, meta, title, content, body)
      : await publishNew(source, title, content, body);
  } catch (e) {
    if (fileUri) throw new Error(errorMessage(e));
    vscode.window.showErrorMessage(errorMessage(e));
  }
}

module.exports = { publishIssueCommand };
