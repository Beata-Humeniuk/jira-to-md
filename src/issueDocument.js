const { serializeFrontMatter, parseFrontMatter } = require('./frontMatter');
const { issueWebUrl } = require('./jiraClient');
const { wikiToMd } = require('./wikiToMd');
const { htmlToMd, looksLikeHtml } = require('./htmlToMd');
const { relinkLocalFiles } = require('./attachments');

const EXTENSION_VERSION = require('../package.json').version;

function isoToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function describeLines(issue) {
  const lines = ['key: ' + issue.key];
  if (issue.type) lines.push('issueType: ' + issue.type);
  if (issue.status) lines.push('status: ' + issue.status);
  if (issue.epic) lines.push('epic: ' + issue.epic);
  lines.push('generator: jira-to-md@' + EXTENSION_VERSION, 'generated: ' + isoToday(), 'managed: true');
  return lines;
}

// previousText is the file being replaced: its links to local files survive Push turning them into attachments.
function withTitle(title, body) {
  return '\n# ' + title + '\n' + (body ? '\n' + body : '');
}

function content(issue, previousText, title) {
  const md = looksLikeHtml(issue.description) ? htmlToMd(issue.description) : wikiToMd(issue.description);
  const body = previousText ? relinkLocalFiles(md, issue.attachments, parseFrontMatter(previousText).body) : md;
  return withTitle(title || issue.summary, body);
}

function issueDocument(issue, previousText) {
  const fm = serializeFrontMatter(
    { url: issueWebUrl(issue.site, issue.key), updated: issue.updated }, describeLines(issue));
  return fm + content(issue, previousText);
}

function topKey(line) {
  return /^\s/.test(line) ? null : line.split(':')[0].trim();
}

function keptLines(previousLines, freshLines) {
  const fresh = new Set(freshLines.map(topKey));
  const kept = [];
  let keep = false;
  for (const line of previousLines) {
    const key = topKey(line);
    if (key !== null) keep = !fresh.has(key);
    if (keep) kept.push(line);
  }
  return kept;
}

// A file whose binding keeps its summary (its title is a Confluence page's, say) keeps its own heading.
function pulledDocument(issue, previousText) {
  const previous = parseFrontMatter(previousText);
  const fresh = describeLines(issue);
  const fm = serializeFrontMatter(
    Object.assign({}, previous.meta, { updated: issue.updated }),
    fresh.concat(keptLines(previous.extraLines, fresh)));
  const own = previous.meta.keepSummary && previous.body.match(/^#[ \t]+(.+?)[ \t]*$/m);
  return fm + content(issue, previousText, own ? own[1] : '');
}

// A file published from outside the download folder, saved there as the issue's file: its own
// Markdown rather than Jira's rendering of it. previousText is the issue's file already there.
function publishedDocument(issue, markdown, previousText) {
  const fresh = describeLines(issue);
  const kept = previousText ? keptLines(parseFrontMatter(previousText).extraLines, fresh) : [];
  const fm = serializeFrontMatter({ url: issueWebUrl(issue.site, issue.key), updated: issue.updated }, fresh.concat(kept));
  return fm + withTitle(issue.summary, String(markdown).trim() ? String(markdown).replace(/^\s+/, '') : '');
}

module.exports = { issueDocument, pulledDocument, publishedDocument };
