// The comments and the attachments of an issue live at the end of its file, each under a ## heading
// carrying a marker, so they never become part of the description.
const COMMENTS = '<!-- jira-comments -->';
const ATTACHMENTS = '<!-- jira-attachments -->';
const SECTION = /^##[ \t].*<!--\s*jira-(comments|attachments)\s*-->\s*$/;
const COMMENT = /^###[ \t]+(.*?)[ \t]*$/;
const COMMENT_ID = /<!--\s*jira-comment\s+(\d+)\s*-->/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

function outsideFences(lines, visit) {
  let fence = '';
  lines.forEach((line, i) => {
    const m = line.match(FENCE);
    if (m && (!fence || m[1][0] === fence[0])) {
      fence = fence ? '' : m[1];
      return;
    }
    if (!fence) visit(line, i);
  });
}

// Headings inside a comment sit below its ### heading: # becomes ####, and back when it is published.
function shiftHeadings(md, by) {
  const lines = String(md).split('\n');
  outsideFences(lines, (line, i) => {
    const m = line.match(/^(#{1,6})([ \t])/);
    if (!m) return;
    const level = Math.min(6, Math.max(1, m[1].length + by));
    lines[i] = '#'.repeat(level) + line.slice(m[1].length);
  });
  return lines.join('\n');
}

function trimLines(lines) {
  return lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
}

function parseComments(lines) {
  const comments = [];
  let current = null;
  const starts = new Set();
  outsideFences(lines, (line, i) => {
    if (COMMENT.test(line)) starts.add(i);
  });
  lines.forEach((line, i) => {
    if (starts.has(i)) {
      const heading = line.match(COMMENT)[1];
      const id = (heading.match(COMMENT_ID) || [])[1] || null;
      current = { id, heading, lines: [] };
      comments.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  });
  return comments.map((c) => ({ id: c.id, heading: c.heading, md: trimLines(c.lines) }));
}

// body: the file below its front matter. main is everything before the first section; a section that
// is absent is null.
function splitSections(body) {
  const lines = String(body).split('\n');
  const marks = [];
  outsideFences(lines, (line, i) => {
    const m = line.match(SECTION);
    if (m) marks.push({ i, kind: m[1] });
  });
  if (!marks.length) return { main: String(body), comments: null, attachments: null };
  const out = { main: lines.slice(0, marks[0].i).join('\n').replace(/\s+$/, '') + '\n', comments: null, attachments: null };
  marks.forEach((mark, n) => {
    const section = lines.slice(mark.i + 1, n + 1 < marks.length ? marks[n + 1].i : lines.length);
    if (mark.kind === 'comments') out.comments = parseComments(section);
    else out.attachments = trimLines(section);
  });
  return out;
}

function commentHeading(comment) {
  const author = (comment.author && (comment.author.displayName || comment.author.name)) || 'Unknown';
  const created = String(comment.created || '').slice(0, 16).replace('T', ' ');
  return author + (created ? ', ' + created : '') + ' <!-- jira-comment ' + comment.id + ' -->';
}

// comments: { heading, md } with md as it stands in the file.
function commentsSection(comments) {
  return '## Comments ' + COMMENTS + '\n' +
    comments.map((c) => '\n### ' + c.heading + '\n' + (c.md ? '\n' + c.md + '\n' : '')).join('');
}

function attachmentsSection(md) {
  return '## Attachments ' + ATTACHMENTS + '\n\n' + md + '\n';
}

function fileList(files) {
  return files.map((f) => '- [' + f.name.replace(/([\[\]])/g, '\\$1') + '](' + f.href + ')').join('\n');
}

// main followed by the sections that are present.
function joinSections(main, comments, attachments) {
  const parts = [String(main).replace(/\s+$/, '')];
  if (comments) parts.push(commentsSection(comments).replace(/\s+$/, ''));
  if (attachments !== null && attachments !== undefined) parts.push(attachmentsSection(attachments).replace(/\s+$/, ''));
  return parts.filter(Boolean).join('\n\n') + '\n';
}

module.exports = { splitSections, joinSections, shiftHeadings, commentHeading, fileList };
