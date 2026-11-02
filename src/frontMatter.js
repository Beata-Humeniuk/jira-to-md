const BLOCK_KEY = /^jira:\s*$/;

function fieldOf(lines, name) {
  const re = new RegExp('^\\s+' + name + ':\\s*(\\S+)\\s*$');
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1];
  }
  return '';
}

// Only the lines indented under jira: belong to the binding, so a confluence: block with its own
// url: can sit next to it.
function parseFrontMatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: null, body: String(text), rawLength: 0, extraLines: [] };
  const lines = m[1].split(/\r?\n/);
  const start = lines.findIndex((line) => BLOCK_KEY.test(line));
  let end = start + 1;
  while (start >= 0 && end < lines.length && (/^\s/.test(lines[end]) || lines[end].trim() === '')) end++;
  const block = start >= 0 ? lines.slice(start + 1, end) : [];
  const url = fieldOf(block, 'url');
  const updated = fieldOf(block, 'updated');
  const keepSummary = fieldOf(block, 'keepSummary') === 'true';
  const bound = !!url;
  const extraLines = lines.filter((line, i) =>
    line.trim() !== '' && (!bound || i < start || i >= end));
  return {
    meta: bound ? Object.assign({ url, updated }, keepSummary ? { keepSummary } : {}) : null,
    body: String(text).slice(m[0].length),
    rawLength: m[0].length,
    extraLines
  };
}

function serializeFrontMatter(meta, extraLines) {
  return ['---', 'jira:', '  url: ' + meta.url, '  updated: ' + meta.updated]
    .concat(meta.keepSummary ? ['  keepSummary: true'] : [], extraLines || [], ['---', '']).join('\n');
}

function frontMatterValue(extraLines, key) {
  const re = new RegExp('^' + key + ':\\s*(.*?)\\s*$');
  for (const line of extraLines || []) {
    const m = line.match(re);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

function withFrontMatterValue(extraLines, key, value) {
  const re = new RegExp('^' + key + ':');
  const lines = (extraLines || []).slice();
  const at = lines.findIndex((line) => re.test(line));
  if (at >= 0) lines[at] = key + ': ' + value;
  else lines.unshift(key + ': ' + value);
  return lines;
}

module.exports = { parseFrontMatter, serializeFrontMatter, frontMatterValue, withFrontMatterValue };
