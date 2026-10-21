const os = require('os');
const vscode = require('vscode');
const { parseDownloadFolder } = require('./fileNames');

function settings() {
  return vscode.workspace.getConfiguration('jiraToMd');
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

function downloadFolderUri() {
  const target = parseDownloadFolder(settings().get('downloadFolder'), os.homedir());
  if (target.kind === 'absolute') return vscode.Uri.file(target.path);
  const document = activeDocument();
  if (target.kind === 'active') {
    return document ? vscode.Uri.joinPath(document.uri, '..') : workspaceFolderUri(null);
  }
  const base = workspaceFolderUri(document);
  return base ? vscode.Uri.joinPath(base, ...target.segments) : null;
}

function askSubfolder() {
  return settings().get('askSubfolder') === true;
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

module.exports = { downloadFolderUri, askSubfolder, configuredToken, configuredEmail, descriptionFormat };
