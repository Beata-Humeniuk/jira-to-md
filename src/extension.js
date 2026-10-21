const vscode = require('vscode');
const { fetchIssueCommand } = require('./fetchCommand');
const { publishIssueCommand } = require('./publishCommand');
const { pullIssueCommand } = require('./pullCommand');
const { handlePreviewUri } = require('./previewActions');
const { previewButtons } = require('./previewButton');

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('jiraToMd.fetchIssue', fetchIssueCommand),
    vscode.commands.registerCommand('jiraToMd.publishIssue', publishIssueCommand),
    vscode.commands.registerCommand('jiraToMd.pullIssue', pullIssueCommand),
    vscode.window.registerUriHandler({ handleUri: handlePreviewUri })
  );
  return {
    extendMarkdownIt: (md) => previewButtons(md,
      { uriScheme: vscode.env.uriScheme, extensionId: context.extension.id })
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
