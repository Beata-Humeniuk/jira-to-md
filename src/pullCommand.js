const vscode = require('vscode');
const { withNotification } = require('./progress');
const { parseFrontMatter } = require('./frontMatter');
const { parseJiraUrl } = require('./jiraClient');
const { contextAndIssue } = require('./issues');
const { pulledDocument } = require('./issueDocument');
const { credentialsFor } = require('./credentials');
const { errorMessage } = require('./messages');

async function confirmPull(document, localUpdated, remoteUpdated) {
  const pull = 'Pull';
  const picked = await vscode.window.showWarningMessage(
    'Update "' + vscode.workspace.asRelativePath(document.uri, false) + '" from Jira (changed ' +
    remoteUpdated + (localUpdated ? ', your copy is from ' + localUpdated : '') + ')? The file content is replaced' +
    (document.isDirty ? ', including your unsaved changes.' : '; changes you have not published are lost.'),
    { modal: true }, pull);
  return picked === pull;
}

async function writeDocument(document, content) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(
    document.positionAt(0), document.positionAt(document.getText().length)), content);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not update ' + document.uri.fsPath);
  await document.save();
}

async function pullDocument(document) {
  const { meta } = parseFrontMatter(document.getText());
  if (!meta) {
    vscode.window.showErrorMessage('This file is not bound to a Jira issue — it has no jira: block in its front matter.');
    return;
  }
  const parsed = parseJiraUrl(meta.url);
  if (!parsed || !parsed.issueKey) throw new Error('bad-url');
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { issue } = await withNotification('Checking Jira for updates…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (meta.updated && issue.updated === meta.updated && !document.isDirty) {
    vscode.window.showInformationMessage('Already up to date — ' + issue.key + ' has not changed in Jira since ' + issue.updated + '.');
    return;
  }
  if (!await confirmPull(document, meta.updated, issue.updated)) return;

  await writeDocument(document, pulledDocument(issue, document.getText()));
  vscode.window.showInformationMessage('Pulled ' + issue.key + ' "' + issue.summary + '".');
}

async function pullIssueCommand(fileUri) {
  const uri = fileUri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!uri) {
    vscode.window.showErrorMessage('Open the Markdown file you want to update from Jira.');
    return;
  }
  try {
    await pullDocument(await vscode.workspace.openTextDocument(uri));
  } catch (e) {
    vscode.window.showErrorMessage(errorMessage(e));
  }
}

module.exports = { pullIssueCommand };
