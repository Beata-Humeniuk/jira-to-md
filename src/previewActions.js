const vscode = require('vscode');
const { pullIssueCommand } = require('./pullCommand');
const { publishIssueCommand } = require('./publishCommand');
const { fileUriCandidates } = require('./previewButton');

async function pushFromPreview(document) {
  const push = 'Push';
  const picked = await vscode.window.showWarningMessage(
    'Push "' + vscode.workspace.asRelativePath(document.uri, false) + '" to Jira?' +
    (document.isDirty ? ' Your unsaved changes are saved first.' : ''),
    { modal: true }, push);
  if (picked !== push) return;
  try {
    if (document.isDirty && !await document.save()) return;
    await publishIssueCommand(document.uri);
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
  }
}

const ACTIONS = {
  '/pull': (document) => pullIssueCommand(document.uri),
  '/push': pushFromPreview
};

// A preview restored after a window reload has no text document behind it, so the file is opened from disk.
async function documentFor(query) {
  const targets = [];
  for (const candidate of fileUriCandidates(query)) {
    try {
      targets.push(vscode.Uri.parse(candidate));
    } catch (e) { }
  }
  const keys = new Set(targets.map((t) => t.toString()));
  const open = vscode.workspace.textDocuments.find((doc) => keys.has(doc.uri.toString()));
  if (open) return open;
  for (const target of targets) {
    try {
      return await vscode.workspace.openTextDocument(target);
    } catch (e) { }
  }
  return null;
}

async function handlePreviewUri(uri) {
  const action = ACTIONS[uri.path];
  if (!action) return;
  const document = await documentFor(uri.query);
  if (!document) {
    vscode.window.showErrorMessage('The Markdown file behind this preview could not be opened. Open it in VS Code, then use the button again.');
    return;
  }
  await action(document);
}

module.exports = { handlePreviewUri };
