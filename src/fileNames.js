const path = require('path');

// "proj-12" + "Add 2FA: login" -> "PROJ-12_Add_2FA_login.md"; characters no file system accepts are dropped.
function issueFileName(key, summary) {
  let name = String(key).toUpperCase();
  const words = String(summary || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^[._]+|[._]+$/g, '')).filter(Boolean);
  for (const word of words) {
    if ((name + '_' + word).length > 100) break;
    name += '_' + word;
  }
  return name + '.md';
}

function expandHome(value, homeDir) {
  if (!homeDir) return value;
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDir, value.slice(2));
  return value;
}

function parseDownloadFolder(configured, homeDir) {
  const value = String(configured == null ? '' : configured).trim();
  if (!value) return { kind: 'active' };
  const expanded = expandHome(value, homeDir);
  if (path.isAbsolute(expanded) || /^[a-zA-Z]:[\\/]/.test(expanded) || expanded.startsWith('/')) {
    return { kind: 'absolute', path: expanded };
  }
  return { kind: 'relative', segments: subfolderSegments(expanded) };
}

function subfolderSegments(text) {
  return String(text || '').split(/[\\/]+/).map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..');
}

module.exports = { issueFileName, parseDownloadFolder, subfolderSegments };
