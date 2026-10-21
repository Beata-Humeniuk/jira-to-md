const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };
const { slugify, issueFileName, parseDownloadFolder, subfolderSegments } = require('../src/fileNames');

assert(slugify('Zażółć gęślą jaźń — Łódź!') === 'zazolc-gesla-jazn-lodz', 'Polish letters are transliterated');
assert(issueFileName('proj-12', 'Add two-factor login') === 'PROJ-12-add-two-factor-login.md', 'key and summary make the name');
assert(issueFileName('PROJ-1', '') === 'PROJ-1.md', 'an empty summary leaves the key');
const long = issueFileName('PROJ-1', 'word '.repeat(40));
assert(long.length <= 63 && long.startsWith('PROJ-1-word-'), 'long summaries are cut at a word, got: ' + long);

assert(parseDownloadFolder('', '/home/u').kind === 'active', 'empty means the active file\'s folder');
assert(parseDownloadFolder('  ', '/home/u').kind === 'active', 'blank means the active file\'s folder');
assert(JSON.stringify(parseDownloadFolder('docs/jira', '/home/u')) === JSON.stringify({ kind: 'relative', segments: ['docs', 'jira'] }), 'relative paths');
assert(parseDownloadFolder('~/notes', '/home/u').path === '/home/u/notes', 'the home folder is expanded');
assert(parseDownloadFolder('C:\\notes', '/home/u').kind === 'absolute', 'Windows paths are absolute');
assert(JSON.stringify(subfolderSegments(' services/../account\\x/ ')) === JSON.stringify(['services', 'account', 'x']), 'subfolders cannot climb up');

console.log('PASS: file names ok');
