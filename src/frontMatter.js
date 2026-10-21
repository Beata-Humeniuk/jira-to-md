function parseFrontMatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: null, body: String(text), rawLength: 0, extraLines: [] };
  const url = (m[1].match(/^\s+url:\s*(\S+)\s*$/m) || [])[1] || '';
  const updated = (m[1].match(/^\s+updated:\s*(\S+)\s*$/m) || [])[1] || '';
  const bound = /^jira:\s*$/m.test(m[1]) && !!url;
  const extraLines = m[1].split(/\r?\n/).filter((line) =>
    line.trim() !== '' && (!bound || (!/^jira:\s*$/.test(line) && !/^\s+(url|updated):/.test(line))));
  return {
    meta: bound ? { url, updated } : null,
    body: String(text).slice(m[0].length),
    rawLength: m[0].length,
    extraLines
  };
}

function serializeFrontMatter(meta, extraLines) {
  return ['---', 'jira:', '  url: ' + meta.url, '  updated: ' + meta.updated]
    .concat(extraLines || [], ['---', '']).join('\n');
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
