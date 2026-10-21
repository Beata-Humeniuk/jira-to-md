const MarkdownIt = require('markdown-it');

function inline(tokens) {
  let out = '';
  const links = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text': out += t.content; break;
      case 'code_inline': out += '{{' + t.content + '}}'; break;
      case 'strong_open': case 'strong_close': out += '*'; break;
      case 'em_open': case 'em_close': out += '_'; break;
      case 's_open': case 's_close': out += '-'; break;
      case 'softbreak': case 'hardbreak': out += '\n'; break;
      case 'image': out += '!' + t.attrGet('src') + '!'; break;
      case 'html_inline': out += t.content; break;
      case 'link_open':
        links.push({ href: t.attrGet('href'), start: out.length, auto: t.markup === 'linkify' || t.markup === 'autolink' });
        break;
      case 'link_close': {
        const l = links.pop();
        out = out.slice(0, l.start) + wikiLink(out.slice(l.start), l.href, l.auto);
        break;
      }
      default: out += t.content || '';
    }
  }
  return out;
}

function wikiLink(text, href, auto) {
  if (auto) return text;
  return text === href ? '[' + href + ']' : '[' + text + '|' + href + ']';
}

function codeBlock(lang, content) {
  const body = String(content).replace(/\n$/, '');
  return lang ? '{code:' + lang + '}\n' + body + '\n{code}' : '{noformat}\n' + body + '\n{noformat}';
}

function singleTokenBlock(t) {
  switch (t.type) {
    case 'fence': return codeBlock((t.info || '').trim().split(/\s+/)[0], t.content);
    case 'code_block': return codeBlock('', t.content);
    case 'hr': return '----';
    case 'html_block': return t.content.replace(/\n$/, '');
    default: return null;
  }
}

function blocks(tokens, start, closeType, markers) {
  const out = [];
  let i = start;
  while (i < tokens.length && tokens[i].type !== closeType) {
    const t = tokens[i];
    const single = singleTokenBlock(t);
    if (single !== null) {
      out.push(single, '');
      i += 1;
      continue;
    }
    switch (t.type) {
      case 'heading_open':
        out.push('h' + t.tag.slice(1) + '. ' + inline(tokens[i + 1].children), '');
        i += 3;
        break;
      case 'paragraph_open':
        out.push(inline(tokens[i + 1].children), '');
        i += 3;
        break;
      case 'blockquote_open': {
        const inner = blocks(tokens, i + 1, 'blockquote_close', markers);
        out.push('{quote}', ...trimBlank(inner.lines), '{quote}', '');
        i = inner.next + 1;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const inner = list(tokens, i, markers.concat(t.type === 'bullet_list_open' ? '*' : '#'));
        out.push(...inner.lines);
        if (!markers.length) out.push('');
        i = inner.next;
        break;
      }
      case 'table_open': {
        const inner = table(tokens, i);
        out.push(...inner.lines, '');
        i = inner.next;
        break;
      }
      default:
        i += 1;
    }
  }
  return { lines: out, next: i };
}

function list(tokens, start, markers) {
  const closeType = tokens[start].type.replace('_open', '_close');
  const out = [];
  let i = start + 1;
  while (tokens[i].type !== closeType) {
    const inner = blocks(tokens, i + 1, 'list_item_close', markers);
    const lines = inner.lines.filter((line) => line !== '');
    let nested = lines.findIndex((line) => /^[*#]+ /.test(line));
    if (nested < 0) nested = lines.length;
    out.push(markers.join('') + ' ' + lines.slice(0, nested).join('\n'), ...lines.slice(nested));
    i = inner.next + 1;
  }
  return { lines: out, next: i + 1 };
}

function table(tokens, start) {
  const out = [];
  let i = start + 1;
  let row = null;
  let head = false;
  while (tokens[i].type !== 'table_close') {
    const t = tokens[i];
    if (t.type === 'tr_open') row = [];
    if (t.type === 'th_open') head = true;
    if (t.type === 'td_open') head = false;
    if (t.type === 'inline') row.push(inline(t.children).replace(/\|/g, '\\|'));
    if (t.type === 'tr_close') {
      const separator = head ? '||' : '|';
      if (!head || row.some((c) => c.trim())) {
        out.push(separator + row.map((c) => ' ' + c + ' ').join(separator) + separator);
      }
    }
    i++;
  }
  return { lines: out, next: i + 1 };
}

function trimBlank(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function mdToWiki(md) {
  const mdit = new MarkdownIt({ html: false, linkify: true });
  const tokens = mdit.parse(String(md == null ? '' : md), {});
  return trimBlank(blocks(tokens, 0, null, []).lines).join('\n');
}

module.exports = { mdToWiki };
