const BOUNDARY_BEFORE = '(^|[\\s([{>"\'/])';
const BOUNDARY_AFTER = '(?=$|[\\s)\\]}<.,;:!?"\'/])';

function span(marker, open, close) {
  const m = marker.replace(/[-*+^~]/g, '\\$&');
  return [new RegExp(BOUNDARY_BEFORE + m + '(?=\\S)([^' + marker + '\\n]*?\\S)' + m + BOUNDARY_AFTER, 'g'),
    (all, before, text) => before + open + text + close];
}

const SPANS = [span('*', '**', '**'), span('_', '_', '_'), span('-', '~~', '~~')];

function link(inner) {
  const bar = inner.indexOf('|');
  if (bar < 0) {
    return /^(https?:|mailto:)/.test(inner) ? '<' + inner + '>' : null;
  }
  const text = inner.slice(0, bar);
  const href = inner.slice(bar + 1).split('|')[0].trim();
  if (!/^(https?:|mailto:|#)/.test(href)) return null;
  return '[' + text + '](' + href + ')';
}

function inline(text) {
  const codes = [];
  let s = String(text).replace(/\{\{([\s\S]*?)\}\}/g, (m, code) => {
    codes.push(code);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = s.replace(/\[([^\[\]\n]+)\]/g, (m, inner) => link(inner) || m);
  for (const [re, to] of SPANS) s = s.replace(re, to);
  s = s.replace(/ ?\\\\ ?(?=\S|$)/g, '\\\n');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const code = codes[Number(i)];
    const fence = code.includes('`') ? '`` ' : '`';
    return fence + code + fence.split('').reverse().join('');
  });
}

function cells(row, separator) {
  const out = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '[' || (row[i] === '{' && row[i + 1] === '{')) depth++;
    if ((row[i] === ']' || (row[i] === '}' && row[i + 1] === '}')) && depth) depth--;
    if (!depth && row.startsWith(separator, i)) {
      out.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += row[i];
  }
  out.push(current);
  return out.slice(1, current.trim() ? undefined : -1).map((c) => c.trim());
}

function tableRow(values) {
  return '| ' + values.map((v) => inline(v).replace(/\|/g, '\\|') || ' ').join(' | ') + ' |';
}

function table(rows) {
  const parsed = rows.map((row) => row.startsWith('||') ? { head: true, cells: cells(row, '||') } : { head: false, cells: cells(row, '|') });
  const width = Math.max(...parsed.map((r) => r.cells.length));
  const pad = (c) => c.concat(Array(width - c.length).fill(''));
  const head = parsed[0].head ? parsed.shift().cells : [];
  const out = [tableRow(pad(head)), '|' + Array(width).fill(' --- ').join('|') + '|'];
  for (const row of parsed) out.push(tableRow(pad(row.cells)));
  return out;
}

function listLine(marker, text, stack) {
  const depth = marker.length;
  const kinds = marker.split('').map((c) => c === '#' ? 'ol' : 'ul');
  while (stack.length > depth || (stack.length && stack[stack.length - 1].kind !== kinds[stack.length - 1])) stack.pop();
  while (stack.length < depth) stack.push({ kind: kinds[stack.length], n: 0 });
  const indent = stack.slice(0, -1).map((level) => ' '.repeat(level.kind === 'ol' ? 3 : 2)).join('');
  const level = stack[stack.length - 1];
  level.n += 1;
  return indent + (level.kind === 'ol' ? level.n + '. ' : '- ') + inline(text);
}

function readBlock(lines, i, first, end) {
  const body = [];
  let rest = first;
  for (;;) {
    const close = rest.indexOf(end);
    if (close >= 0) {
      body.push(rest.slice(0, close));
      return { body, last: i };
    }
    body.push(rest);
    if (++i >= lines.length) return { body, last: i - 1 };
    rest = lines[i];
  }
}

function codeBlock(lines, i, match) {
  const [, kind, params, first] = match;
  const param = (params || '').split('|')[0];
  const lang = kind === 'code' && param && !param.includes('=') ? param.trim() : '';
  const { body, last } = readBlock(lines, i, first, '{' + kind + '}');
  const text = body.join('\n').replace(/^\n+|\n+$/g, '');
  const fence = text.includes('```') ? '````' : '```';
  return { md: [fence + lang, ...(text ? text.split('\n') : []), fence], last };
}

function quoteBlock(lines, i, first) {
  const { body, last } = readBlock(lines, i, first, '{quote}');
  const inner = wikiToMd(body.join('\n')).replace(/\n+$/, '');
  return { md: inner.split('\n').map((l) => l ? '> ' + l : '>'), last };
}

function tableBlock(lines, i) {
  const rows = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
  return { md: table(rows), last: i - 1 };
}

function singleLineBlock(trimmed) {
  const heading = trimmed.match(/^h([1-6])\.\s+(.*)$/);
  if (heading) return '#'.repeat(Number(heading[1])) + ' ' + inline(heading[2]);
  const quote = trimmed.match(/^bq\.\s+(.*)$/);
  if (quote) return '> ' + inline(quote[1]);
  if (/^-{4,}$/.test(trimmed)) return '---';
  return null;
}

function multiLineBlock(lines, i, trimmed) {
  const code = trimmed.match(/^\{(code|noformat)(?::([^}]*))?\}(.*)$/);
  if (code) return codeBlock(lines, i, code);
  if (trimmed.startsWith('{quote}')) return quoteBlock(lines, i, trimmed.slice('{quote}'.length));
  if (trimmed.startsWith('|')) return tableBlock(lines, i);
  return null;
}

function wikiToMd(wiki) {
  const lines = String(wiki == null ? '' : wiki).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = [];
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };
  const block = (md) => {
    blank();
    list = [];
    out.push(...md, '');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const multi = multiLineBlock(lines, i, trimmed);
    if (multi) {
      block(multi.md);
      i = multi.last;
      continue;
    }
    if (/^\{(panel|color|div)(:[^}]*)?\}$/.test(trimmed)) continue;
    if (!trimmed) {
      list = [];
      blank();
      continue;
    }
    const single = singleLineBlock(trimmed);
    if (single !== null) {
      block([single]);
      continue;
    }

    const item = line.match(/^\s*([*#]+|-)\s+(.*)$/);
    if (item) {
      if (!list.length) blank();
      out.push(listLine(item[1].replace('-', '*'), item[2], list));
    } else if (list.length) {
      const previous = out[out.length - 1];
      const indent = previous.match(/^\s*(?:\d+\. |- )/)[0].length;
      out[out.length - 1] = previous + '\\\n' + ' '.repeat(indent) + inline(trimmed);
    } else {
      out.push(inline(line.replace(/\s+$/, '')));
    }
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}

module.exports = { wikiToMd };
