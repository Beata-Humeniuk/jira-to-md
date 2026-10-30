const { posix } = require('path');
const MarkdownIt = require('markdown-it');

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch (e) {
    return path;
  }
}

function baseName(path) {
  return path.split(/[\\/]/).pop();
}

function isLocal(href) {
  return !!href && !SCHEME.test(href) && !/^[#/\\]/.test(href);
}

function eachLink(tokens, visit) {
  for (const t of tokens) {
    if (t.type === 'link_open') visit(t, 'href');
    if (t.type === 'image') visit(t, 'src');
    if (t.children) eachLink(t.children, visit);
  }
}

// Links and images pointing at files next to the Markdown file: href as markdown-it normalises it,
// path relative to the file's folder.
function localTargets(md) {
  const tokens = new MarkdownIt({ linkify: true }).parse(String(md == null ? '' : md), {});
  const out = new Map();
  eachLink(tokens, (t, attr) => {
    const href = t.attrGet(attr);
    const path = decodePath(String(href || '').replace(/[?#].*$/, ''));
    if (isLocal(href) && path && !out.has(href)) out.set(href, { href, path, name: baseName(path) });
  });
  return Array.from(out.values());
}

// Points links listed in env.links ({ [href]: { url, filename } }) at their Jira attachments;
// target(attachment, attr) says what the link becomes.
function attachmentLinks(md, target) {
  md.core.ruler.push('jira_to_md_attachments', (state) => {
    const links = state.env && state.env.links;
    if (!links) return;
    eachLink(state.tokens, (t, attr) => {
      const attachment = links[t.attrGet(attr)];
      if (attachment) t.attrSet(attr, target(attachment, attr));
    });
  });
  return md;
}

// After a download, links to attachments of files the previous version linked locally point there again.
function relinkLocalFiles(md, attachments, previousBody) {
  const local = new Map(localTargets(previousBody).map((t) => [t.name, t.href]));
  if (!local.size) return md;
  let out = md;
  for (const a of attachments || []) {
    const href = local.get(a.filename);
    if (!href || !a.content) continue;
    out = out.split('](' + a.content + ')').join('](' + href + ')')
      .split('<' + a.content + '>').join('[' + a.filename + '](' + href + ')');
  }
  return out.replace(/\[([^\[\]|\n]*)\|\^([^\]|\n]+)\]|\[\^([^\]|\n]+)\]/g, (m, text, name, bare) => {
    const href = local.get(name || bare);
    return href ? '[' + (text || bare) + '](' + href + ')' : m;
  });
}

// Relative links and images of a file copied from fromDir to toDir point at the same files again.
function rebaseLinks(md, fromDir, toDir) {
  if (fromDir === toDir) return String(md);
  return String(md).replace(/(\]\(\s*<?)([^()\s<>]+)/g, (m, open, href) => {
    if (!isLocal(href)) return m;
    const at = href.search(/[?#]/);
    const path = at < 0 ? href : href.slice(0, at);
    const rest = at < 0 ? '' : href.slice(at);
    return open + (posix.relative(toDir, posix.join(fromDir, path)) || '.') + rest;
  });
}

module.exports = { localTargets, attachmentLinks, relinkLocalFiles, rebaseLinks };
