const vscode = require('vscode');

function withNotification(title, task) {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
}

module.exports = { withNotification };
