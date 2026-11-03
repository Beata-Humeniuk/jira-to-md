const fs = require('fs');
const path = require('path');

// The webview that draws ```mermaid blocks for Jira loads Mermaid from the extension, not from the web.
const source = path.join(__dirname, '..', 'node_modules', 'mermaid');
const target = path.join(__dirname, '..', 'out', 'mermaid');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(source, 'dist', 'mermaid.min.js'), path.join(target, 'mermaid.min.js'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
console.log('Copied Mermaid to out/mermaid');
