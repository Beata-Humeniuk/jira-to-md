const { wikiToMd } = require('../src/wikiToMd');
const { mdToWiki } = require('../src/mdToWiki');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const PROPOSAL = [
  '## Why',
  '',
  'Users need **two-factor** login, see [the RFC](https://example.com/rfc_6238) and `totp`.',
  '',
  '## What Changes',
  '',
  '- Add a TOTP step',
  '  - nested detail',
  '- [ ] 1.1 Create the schema',
  '- [x] 1.2 Write the tests',
  '',
  '1. first',
  '2. second',
  '',
  '> A quote',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '| Spec | Impact |',
  '| --- | --- |',
  '| auth | ~~none~~ _high_ |',
  '',
  'See https://example.com for more.',
  ''
].join('\n');

const wiki = mdToWiki(PROPOSAL);
assert(wiki.includes('h2. Why'), 'headings become hN.');
assert(wiki.includes('*two-factor*') && wiki.includes('{{totp}}'), 'bold and inline code');
assert(wiki.includes('[the RFC|https://example.com/rfc_6238]'), 'links become [text|url]');
assert(wiki.includes('\n** nested detail'), 'nested bullets');
assert(wiki.includes('* [ ] 1.1 Create the schema'), 'task checkboxes stay as text');
assert(wiki.includes('# first\n# second'), 'numbered lists');
assert(wiki.includes('{quote}\nA quote\n{quote}'), 'quotes');
assert(wiki.includes('{code:ts}\nconst a = 1;\n{code}'), 'fenced code with a language');
assert(wiki.includes('|| Spec || Impact ||') && wiki.includes('| auth | -none- _high_ |'), 'tables');
assert(wiki.includes('See https://example.com for more.'), 'bare links stay bare');

const back = wikiToMd(wiki);
assert(back === PROPOSAL, 'Markdown survives a round trip through Jira, got:\n' + back);
assert(mdToWiki(back) === wiki, 'and the wiki markup is stable');

const md = wikiToMd([
  'h3. Notes',
  'Some *bold*, _italic_, -struck- text and a well-known date 2026-09-25.',
  '# one',
  '## one.one',
  '# two',
  '',
  '{code:title=Example.java|borderStyle=solid}',
  'class A {}',
  '{code}',
  '{noformat}raw *text*{noformat}',
  'bq. short quote',
  '||a||b||',
  '|[link|https://x.io]|{{c|d}}|',
  '|no header|row|',
  '----',
  '[~accountid:123] please check !screenshot.png|thumbnail!'
].join('\n'));
assert(md.includes('### Notes'), 'wiki headings');
assert(md.includes('Some **bold**, _italic_, ~~struck~~ text and a well-known date 2026-09-25.'), 'inline formatting, hyphens in words untouched');
assert(md.includes('1. one\n   1. one.one\n2. two'), 'nested numbered lists, got:\n' + md);
assert(md.includes('```\nclass A {}\n```'), 'code parameters are not taken for a language');
assert(md.includes('```\nraw *text*\n```'), 'noformat content is kept verbatim');
assert(md.includes('> short quote'), 'bq.');
assert(md.includes('| a | b |') && md.includes('| [link](https://x.io) | `c\\|d` |'), 'table cells split around links and code, got:\n' + md);
assert(md.includes('[~accountid:123] please check !screenshot.png|thumbnail!'), 'mentions and images stay as written');
assert(wikiToMd('') === '' && mdToWiki('') === '', 'empty descriptions');
assert(wikiToMd(null) === '', 'a missing description');

console.log('PASS: wiki markup <-> markdown ok');
