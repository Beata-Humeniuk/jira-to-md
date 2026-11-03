const crypto = require('crypto');
const MarkdownIt = require('markdown-it');

const ALT = 'Mermaid diagram';
const NAME = /^mermaid-[0-9a-f]{12}\.png$/;

function normalized(source) {
  return String(source).replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
}

// The name follows the source, so an unchanged diagram reuses its attachment instead of being drawn again.
function diagramName(source) {
  return 'mermaid-' + crypto.createHash('sha256').update(normalized(source)).digest('hex').slice(0, 12) + '.png';
}

function mermaidFences(md) {
  const tokens = new MarkdownIt().parse(String(md == null ? '' : md), {});
  return tokens.filter((t) => t.type === 'fence' && t.map && t.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid');
}

// ```mermaid blocks of the Markdown, once per source.
function diagramsIn(md) {
  const seen = new Map();
  for (const t of mermaidFences(md)) {
    const name = diagramName(t.content);
    if (!seen.has(name)) seen.set(name, { name, source: normalized(t.content) });
  }
  return Array.from(seen.values());
}

// Blocks whose diagram is named in `names` become an image of it; links then point the image at the attachment.
function withDiagramImages(md, names) {
  const lines = String(md).split('\n');
  const fences = mermaidFences(md).filter((t) => names.has(diagramName(t.content)));
  for (const t of fences.reverse()) {
    const [start, end] = t.map;
    const prefix = (lines[start].match(/^(.*?)(?:`{3,}|~{3,})/) || ['', ''])[1];
    lines.splice(start, end - start, prefix + '![' + ALT + '](' + diagramName(t.content) + ')');
  }
  return lines.join('\n');
}

function fence(source) {
  return '```mermaid\n' + source + '\n```';
}

// After a download, images of diagrams the previous version of the file had as ```mermaid blocks become those blocks again.
function restoreDiagrams(md, attachments, previousBody) {
  const sources = new Map(diagramsIn(previousBody).map((d) => [d.name, d.source]));
  if (!sources.size) return md;
  let out = String(md);
  for (const a of attachments || []) {
    const source = NAME.test(a.filename) && sources.get(a.filename);
    if (source && a.content) out = out.split('](' + a.content + ')').join('](' + a.filename + ')');
  }
  return out
    .replace(/!\[[^\]\n]*\]\((mermaid-[0-9a-f]{12}\.png)\)/g, (m, name) => (sources.has(name) ? fence(sources.get(name)) : m))
    .replace(/!(mermaid-[0-9a-f]{12}\.png)(?:\|[^!\n]*)?!/g, (m, name) => (sources.has(name) ? fence(sources.get(name)) : m));
}

module.exports = { diagramName, diagramsIn, withDiagramImages, restoreDiagrams };
