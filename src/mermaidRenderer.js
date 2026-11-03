const vscode = require('vscode');

const TIMEOUT_MS = 60000;
let extensionUri = null;

function initMermaidRenderer(context) {
  extensionUri = context.extensionUri;
}

function pageHtml(webview) {
  const script = (...path) => '<script src="' + webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...path)) + '"></script>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; ' +
    'style-src \'unsafe-inline\'; script-src ' + webview.cspSource + ';">' +
    '</head><body>' + script('out', 'mermaid', 'mermaid.min.js') + script('media', 'mermaidRenderer.js') +
    '</body></html>';
}

// Draws diagrams in a webview, the only browser engine VS Code offers; nothing leaves the computer.
// Resolves to one { png: Buffer } or { error: string } per source.
function renderDiagrams(sources) {
  if (!extensionUri) return Promise.resolve(sources.map(() => ({ error: 'the diagram renderer is not available' })));
  const panel = vscode.window.createWebviewPanel('jiraToMd.mermaid', 'Jira: drawing diagrams…',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'mermaid'), vscode.Uri.joinPath(extensionUri, 'media')]
    });
  const results = sources.map(() => null);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(results.map((r) => r || { error: reason }));
      panel.dispose();
    };
    const timer = setTimeout(() => finish('drawing took too long'), TIMEOUT_MS);
    panel.onDidDispose(() => finish('the drawing window was closed'));
    panel.webview.onDidReceiveMessage((message) => {
      if (message.ready) {
        sources.forEach((source, id) => panel.webview.postMessage({ id, source }));
        return;
      }
      if (typeof message.id !== 'number' || !(message.id in results)) return;
      results[message.id] = message.png ? { png: Buffer.from(message.png, 'base64') } : { error: message.error || 'unknown error' };
      if (results.every(Boolean)) finish('');
    });
    panel.webview.html = pageHtml(panel.webview);
  });
}

module.exports = { initMermaidRenderer, renderDiagrams };
