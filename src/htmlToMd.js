const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'area', 'base', 'source']);
const DROP = new Set(['script', 'style', 'head', 'title']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'hr', 'table', 'dl', 'dt', 'dd']);
const HTML_HINT = /<\/?(p|div|h[1-6]|ol|ul|li|br|table|tr|td|th|pre|blockquote)(\s[^>]*)?\/?>/i;

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', bdquo: '„', lsquo: '‘', rsquo: '’', bull: '•',
  middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', times: '×', rarr: '→', larr: '←', euro: '€'
};

function looksLikeHtml(text) {
  return HTML_HINT.test(String(text || ''));
}

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code ? String.fromCodePoint(code).replace('\u00a0', ' ') : m;
    }
    const value = ENTITIES[name.toLowerCase()];
    return value === undefined ? m : value;
  });
}

function attrs(source) {
  const out = {};
  const re = /([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(source))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function parse(html) {
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (tag, stopAt) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stopAt && stopAt.includes(stack[i].tag)) return;
      if (stack[i].tag === tag) {
        stack.length = i;
        return;
      }
    }
  };
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      top().children.push({ text: m[4] });
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      closeTo(tag);
      continue;
    }
    if (tag === 'li') closeTo('li', ['ul', 'ol']);
    if (tag === 'tr') closeTo('tr', ['table']);
    if (tag === 'td' || tag === 'th') {
      closeTo('td', ['tr', 'table']);
      closeTo('th', ['tr', 'table']);
    }
    if (BLOCK.has(tag) && top().tag === 'p') stack.pop();
    const node = { tag, attrs: attrs(m[3]), children: [] };
    top().children.push(node);
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(node);
  }
  return root;
}

function rawText(node) {
  if (node.text !== undefined) return decode(node.text);
  if (node.tag === 'br') return '\n';
  return node.children.map(rawText).join('');
}

function escapeText(text) {
  return text.replace(/\\/g, '\\\\').replace(/<(?=[a-zA-Z\/!])/g, '\\<').replace(/([*`])/g, '\\$1');
}

function wrap(marker, inner) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m[2] ? m[1] + marker + m[2] + marker + m[3] : inner;
}

function codeSpan(text) {
  const fence = text.includes('`') ? '``' : '`';
  const pad = fence.length > 1 ? ' ' : '';
  return fence + pad + text + pad + fence;
}

function inline(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.text !== undefined) {
      out += escapeText(decode(node.text).replace(/[\s\u00a0]+/g, ' '));
      continue;
    }
    const inner = () => inline(node.children);
    switch (node.tag) {
      case 'br': out += '\\\n'; break;
      case 'strong': case 'b': out += wrap('**', inner()); break;
      case 'em': case 'i': out += wrap('_', inner()); break;
      case 's': case 'del': case 'strike': out += wrap('~~', inner()); break;
      case 'code': case 'tt': case 'kbd': out += codeSpan(rawText(node).replace(/\s+/g, ' ')); break;
      case 'a': {
        const text = inner().trim();
        const href = node.attrs.href || '';
        if (!href || href.startsWith('javascript:')) out += text;
        else if (!text || text === href) out += '<' + href + '>';
        else out += '[' + text + '](' + href.replace(/[()\s]/g, encodeURIComponent) + ')';
        break;
      }
      case 'img': out += '![' + (node.attrs.alt || '') + '](' + (node.attrs.src || '') + ')'; break;
      default: if (!DROP.has(node.tag)) out += inner();
    }
  }
  return out;
}

function cleanInline(text) {
  return text.split('\n').map((l) => l.trim()).join('\n')
    .replace(/^(\\\n)+|(\\\n?)+$/g, '').trim();
}

function indent(text, prefix, first) {
  return text.split('\n').map((l, i) => (i === 0 ? first : l ? prefix : '') + l).join('\n');
}

function list(node) {
  const ordered = node.tag === 'ol';
  let n = Number(node.attrs.start) || 1;
  const items = [];
  for (const child of node.children) {
    if (child.text !== undefined && !child.text.trim()) continue;
    const parts = child.tag === 'li' ? blocks(child.children) : blocks([child]);
    if (child.tag !== 'li' && !parts.length) continue;
    const marker = ordered ? n++ + '. ' : '- ';
    let body = '';
    parts.forEach((part, i) => {
      if (i) body += /^(\s*)(- |\d+\. )/.test(part) ? '\n' : '\n\n';
      body += part;
    });
    items.push(indent(body, ' '.repeat(marker.length), marker));
  }
  return items.join('\n');
}

function table(node) {
  const rows = [];
  const collect = (n) => {
    for (const c of n.children || []) {
      if (c.tag === 'tr') rows.push(c);
      else if (c.tag) collect(c);
    }
  };
  collect(node);
  if (!rows.length) return '';
  const cells = rows.map((r) => r.children.filter((c) => c.tag === 'td' || c.tag === 'th')
    .map((c) => cleanInline(inline(c.children)).replace(/\\\n|\n/g, ' ').replace(/\|/g, '\\|')));
  const width = Math.max(...cells.map((c) => c.length));
  const row = (c) => '| ' + c.concat(Array(width - c.length).fill('')).map((v) => v || ' ').join(' | ') + ' |';
  const head = rows[0].children.some((c) => c.tag === 'th') ? cells.shift() : [];
  return [row(head), '|' + Array(width).fill(' --- ').join('|') + '|', ...cells.map(row)].join('\n');
}

function block(node) {
  const heading = node.tag.match(/^h([1-6])$/);
  if (heading) {
    const text = cleanInline(inline(node.children)).replace(/\\\n/g, ' ');
    return text ? ['#'.repeat(Number(heading[1])) + ' ' + text] : [];
  }
  switch (node.tag) {
    case 'ul': case 'ol': {
      const md = list(node);
      return md ? [md] : [];
    }
    case 'pre': {
      const code = node.children.find((c) => c.tag === 'code');
      const lang = ((code && code.attrs.class) || node.attrs.class || '').match(/(?:language|lang)-(\S+)/);
      const text = rawText(node).replace(/^\n+|\n+$/g, '');
      const fence = text.includes('```') ? '````' : '```';
      return [fence + (lang ? lang[1] : '') + '\n' + (text ? text + '\n' : '') + fence];
    }
    case 'blockquote': {
      const inner = blocks(node.children).join('\n\n');
      return inner ? [inner.split('\n').map((l) => l ? '> ' + l : '>').join('\n')] : [];
    }
    case 'hr': return ['---'];
    case 'table': {
      const md = table(node);
      return md ? [md] : [];
    }
    default: return blocks(node.children);
  }
}

function blocks(nodes) {
  const out = [];
  let pending = [];
  const flush = () => {
    const text = cleanInline(inline(pending));
    if (text) out.push(text);
    pending = [];
  };
  for (const node of nodes) {
    if (node.tag && DROP.has(node.tag)) continue;
    if (node.tag && BLOCK.has(node.tag)) {
      flush();
      out.push(...block(node));
    } else {
      pending.push(node);
    }
  }
  flush();
  return out;
}

function htmlToMd(html) {
  const md = blocks(parse(String(html == null ? '' : html).replace(/\r\n?/g, '\n')).children).join('\n\n');
  return md ? md + '\n' : '';
}

module.exports = { htmlToMd, looksLikeHtml };
