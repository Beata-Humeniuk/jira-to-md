const vscode = require('vscode');
const { withNotification } = require('./progress');
const { mdToWiki } = require('./mdToWiki');
const { mdToHtml } = require('./mdToHtml');
const { looksLikeHtml } = require('./htmlToMd');
const { parseFrontMatter, serializeFrontMatter } = require('./frontMatter');
const { parseJiraUrl, isCloud, issueWebUrl, fetchIssue, createIssue, updateIssue } = require('./jiraClient');
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
function descriptionFor(content, sample) {
  const format = descriptionFormat();
  const html = format === 'auto' ? looksLikeHtml(sample) : format === 'html';
  return html ? mdToHtml(content) : mdToWiki(content);
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

  const description = descriptionFor(content, current.fields.description);
  const body = { fields: { summary: title, description } };
  const updated = await withNotification('Pushing ' + current.key + ' to Jira…', async () => {
    await updateIssue(creds, parsed.site, current.key, body);
    return fetchIssue(creds, parsed.site, current.key, ['updated']);
  });

  await writeBinding(source, { url: meta.url, updated: updated.fields.updated });
  vscode.window.showInformationMessage('Pushed ' + current.key + ' "' + title + '".');
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
    const fresh = await fetchIssue(creds, parsed.site, made.key, ['updated']);
    return { key: made.key, updated: fresh.fields.updated };
  });

  const url = issueWebUrl(parsed.site, created.key);
  await writeBinding(source, { url, updated: created.updated });
  vscode.window.showInformationMessage('Created ' + created.key + ' "' + title + '"' +
    (epic ? ' in epic ' + epic.key : '') + '.');
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
