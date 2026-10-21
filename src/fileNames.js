const path = require('path');

function slugify(text) {
  return String(text)
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function issueFileName(key, summary) {
  let name = String(key).toUpperCase();
  for (const word of slugify(summary).split('-').filter(Boolean)) {
    if ((name + '-' + word).length > 60) break;
    name += '-' + word;
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

module.exports = { slugify, issueFileName, parseDownloadFolder, subfolderSegments };
