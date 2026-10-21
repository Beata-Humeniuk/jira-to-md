const vscode = require('vscode');
const { hostOf, authFor } = require('./jiraClient');
const { configuredToken, configuredEmail } = require('./config');

async function showTokenSettingsError(host) {
  const open = 'Open Settings';
  const picked = await vscode.window.showErrorMessage(
    'No Jira token for ' + host + ' — set jiraToMd.token in the extension settings.',
    open);
  if (picked === open) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'jiraToMd.token');
  }
}

async function credentialsFor(site) {
  const token = configuredToken();
  if (!token) {
    await showTokenSettingsError(hostOf(site.origin));
    return null;
  }
  return authFor(site, token, configuredEmail());
}

module.exports = { credentialsFor };
