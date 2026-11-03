const vscode = require('vscode');
const { downloadAttachment, fetchComments } = require('./jiraClient');
const { localTargets } = require('./attachments');

const DIAGRAM = /^mermaid-[0-9a-f]{12}\.png$/;

async function sizeOf(uri) {
  try {
    return (await vscode.workspace.fs.stat(uri)).size;
  } catch (e) {
    return -1;
  }
}

function safeName(name) {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '_') || 'file';
}

// Attachments of the issue are saved next to its file, in attachments/<KEY>/, unless the file already
// links a local file of the same name. Drawn Mermaid diagrams are left out: Pull turns them back into code.
// Returns filename -> href for the links, and the list for the Attachments section.
async function downloadAttachments(creds, issue, fileUri, previousBody) {
  const known = new Map(localTargets(previousBody).map((t) => [t.name, t.href]));
  const folder = vscode.Uri.joinPath(fileUri, '..');
  const byName = new Map();
  const newest = (issue.attachments || []).slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  for (const a of newest) {
    if (DIAGRAM.test(a.filename) || byName.has(a.filename)) continue;
    let href = known.get(a.filename);
    if (!href || await sizeOf(vscode.Uri.joinPath(folder, ...decodeURI(href.replace(/[?#].*$/, '')).split('/'))) < 0) {
      const segments = ['attachments', issue.key, safeName(a.filename)];
      const target = vscode.Uri.joinPath(folder, ...segments);
      if (await sizeOf(target) !== Number(a.size)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, ...segments.slice(0, -1)));
        await vscode.workspace.fs.writeFile(target, await downloadAttachment(creds, a.content));
      }
      href = './' + segments.map(encodeURIComponent).join('/');
    }
    byName.set(a.filename, href);
  }
  return {
    byName,
    list: Array.from(byName, ([name, href]) => ({ name, href })).sort((x, y) => x.name.localeCompare(y.name))
  };
}

// What Pull and Download add to the issue for its file at fileUri, by jiraToMd.sync parts.
async function issueExtras(creds, issue, fileUri, previousBody, parts) {
  return {
    comments: parts.comments ? await fetchComments(creds, issue.site, issue.key) : null,
    files: parts.attachments ? await downloadAttachments(creds, issue, fileUri, previousBody) : null
  };
}

module.exports = { downloadAttachments, issueExtras };
