const { serializeFrontMatter, parseFrontMatter } = require('./frontMatter');
const { issueWebUrl } = require('./jiraClient');
const { wikiToMd } = require('./wikiToMd');
const { htmlToMd, looksLikeHtml } = require('./htmlToMd');
const { relinkLocalFiles } = require('./attachments');
const { restoreDiagrams } = require('./mermaidImages');
const { splitSections, joinSections, shiftHeadings, commentHeading, fileList } = require('./sections');

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

function withTitle(title, body) {
  return '\n# ' + title + '\n' + (body ? '\n' + body : '');
}

const H1 = /^#[ \t]+(.+?)[ \t]*$/m;

// Jira markup of a description or a comment as Markdown. Links to attachments lead to the local files
// the previous version of the file linked, or to those downloaded next to it, and drawn diagrams are
// Mermaid code again.
function jiraMd(text, issue, previousBody, downloaded) {
  const md = looksLikeHtml(text) ? htmlToMd(text) : wikiToMd(text);
  return relinkLocalFiles(restoreDiagrams(md, issue.attachments, previousBody), issue.attachments, previousBody, downloaded);
}

// The heading and the description, each from Jira or, for a part not synced, as the file has it.
// Without the summary the file's heading is its own, and a description starting with it needs no other.
function mainPart(issue, previousMain, parts, previousBody, downloaded) {
  if (!parts.description) {
    if (!parts.summary) return previousMain;
    return H1.test(previousMain) ? previousMain.replace(H1, '# ' + issue.summary)
      : withTitle(issue.summary, previousMain.replace(/^\s+/, ''));
  }
  const body = jiraMd(issue.description, issue, previousBody, downloaded);
  const own = !parts.summary && previousMain.match(H1);
  if (own && /^#[ \t]+\S/.test(body)) return '\n' + body;
  return withTitle(own ? own[1] : issue.summary, body);
}

// A Jira comment as the Comments section of the file holds it.
function commentMarkdown(issue, comment, previousBody, downloaded) {
  return shiftHeadings(jiraMd(comment.body, issue, previousBody, downloaded), 3).replace(/\s+$/, '');
}

// Jira's comments, followed by comments written in the file and not published yet.
function commentsPart(issue, comments, previous, previousBody, downloaded) {
  if (!comments) return previous.comments;
  const fresh = comments.map((c) => ({
    id: String(c.id),
    heading: commentHeading(c),
    md: commentMarkdown(issue, c, previousBody, downloaded)
  }));
  const all = fresh.concat((previous.comments || []).filter((c) => !c.id && c.md.trim()));
  return all.length ? all : null;
}

// options.parts: what is taken from Jira (jiraToMd.sync); options.comments: the issue's comments when they
// are synced; options.files: the attachments downloaded next to the file when they are.
function documentBody(issue, previousText, options) {
  const parts = options.parts;
  const previousBody = previousText ? parseFrontMatter(previousText).body : '';
  const previous = splitSections(previousBody);
  const downloaded = options.files ? options.files.byName : null;
  const attachments = options.files ? (options.files.list.length ? fileList(options.files.list) : null) : previous.attachments;
  return joinSections(mainPart(issue, previous.main, parts, previousBody, downloaded),
    commentsPart(issue, options.comments, previous, previousBody, downloaded), attachments);
}

// previousText is the file being replaced: its links to local files survive Publish turning them into attachments.
function issueDocument(issue, previousText, options) {
  const fm = serializeFrontMatter(
    { url: issueWebUrl(issue.site, issue.key), updated: issue.updated }, describeLines(issue));
  return fm + documentBody(issue, previousText,
    Object.assign({}, options, { parts: { summary: true, description: true } }));
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

function pulledDocument(issue, previousText, options) {
  const previous = parseFrontMatter(previousText);
  const fresh = describeLines(issue);
  const fm = serializeFrontMatter(
    Object.assign({}, previous.meta, { updated: issue.updated }),
    fresh.concat(keptLines(previous.extraLines, fresh)));
  return fm + documentBody(issue, previousText, options);
}

// A file published from outside the download folder, saved there as the issue's file: its own
// Markdown rather than Jira's rendering of it. previousText is the issue's file already there.
function publishedDocument(issue, markdown, previousText) {
  const fresh = describeLines(issue);
  const kept = previousText ? keptLines(parseFrontMatter(previousText).extraLines, fresh) : [];
  const fm = serializeFrontMatter({ url: issueWebUrl(issue.site, issue.key), updated: issue.updated }, fresh.concat(kept));
  return fm + withTitle(issue.summary, String(markdown).trim() ? String(markdown).replace(/^\s+/, '') : '');
}

module.exports = { issueDocument, pulledDocument, publishedDocument, commentMarkdown };
