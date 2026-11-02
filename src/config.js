const os = require('os');
const vscode = require('vscode');
const { parseDownloadFolder } = require('./fileNames');

// With a resource, folder settings (.vscode/settings.json of a workspace folder) apply too.
function settings(resource) {
  return vscode.workspace.getConfiguration('jiraToMd', resource);
}

function workspaceFolderUri(document) {
  const own = document && vscode.workspace.getWorkspaceFolder(document.uri);
  const folder = own || (vscode.workspace.workspaceFolders || [])[0];
  return folder ? folder.uri : null;
}

function activeDocument() {
  const editor = vscode.window.activeTextEditor;
  return editor && editor.document && editor.document.uri.scheme === 'file' ? editor.document : null;
}

function settingsResource(document) {
  return document ? document.uri : workspaceFolderUri(null);
}

function downloadFolderUri() {
  const document = activeDocument();
  const target = parseDownloadFolder(settings(settingsResource(document)).get('downloadFolder'), os.homedir());
  if (target.kind === 'absolute') return vscode.Uri.file(target.path);
  if (target.kind === 'active') {
    return document ? vscode.Uri.joinPath(document.uri, '..') : workspaceFolderUri(null);
  }
  const base = workspaceFolderUri(document);
  return base ? vscode.Uri.joinPath(base, ...target.segments) : null;
}

// The download folder for a file published from elsewhere; null when it is "next to the active file".
function packageRootUri(resource) {
  const target = parseDownloadFolder(settings(resource).get('downloadFolder'), os.homedir());
  if (target.kind === 'absolute') return vscode.Uri.file(target.path);
  if (target.kind === 'active') return null;
  const own = resource && vscode.workspace.getWorkspaceFolder(resource);
  const base = own ? own.uri : workspaceFolderUri(null);
  return base ? vscode.Uri.joinPath(base, ...target.segments) : null;
}

function askSubfolder() {
  return settings(settingsResource(activeDocument())).get('askSubfolder') === true;
}

function configuredToken() {
  const token = String(settings().get('token') || '').trim();
  return token || null;
}

function configuredEmail() {
  return settings().get('email') || '';
}

function descriptionFormat() {
  const value = String(settings().get('descriptionFormat') || '').trim().toLowerCase();
  return value === 'wiki' || value === 'auto' ? value : 'html';
}

module.exports = { downloadFolderUri, packageRootUri, askSubfolder, configuredToken, configuredEmail, descriptionFormat };
