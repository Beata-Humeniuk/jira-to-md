const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };
const { issueFileName, parseDownloadFolder, subfolderSegments } = require('../src/fileNames');

assert(issueFileName('proj-12', 'Add two-factor login') === 'PROJ-12_Add_two-factor_login.md', 'upper-case key, spaces become underscores');
assert(issueFileName('P1726-07', 'Zmiana pakietu: wywołanie  Read/Current?') === 'P1726-07_Zmiana_pakietu_wywołanie_Read_Current.md',
  'Polish letters stay, characters a file system rejects are dropped');
assert(issueFileName('PROJ-1', '') === 'PROJ-1.md', 'an empty summary leaves the key');
assert(issueFileName('PROJ-1', '... .hidden.') === 'PROJ-1_hidden.md', 'no leading or trailing dots');
const long = issueFileName('PROJ-1', 'word '.repeat(40));
assert(long.length <= 103 && long.startsWith('PROJ-1_word_'), 'long summaries are cut at a word, got: ' + long);

assert(parseDownloadFolder('', '/home/u').kind === 'active', 'empty means the active file\'s folder');
assert(parseDownloadFolder('  ', '/home/u').kind === 'active', 'blank means the active file\'s folder');
assert(JSON.stringify(parseDownloadFolder('docs/jira', '/home/u')) === JSON.stringify({ kind: 'relative', segments: ['docs', 'jira'] }), 'relative paths');
assert(parseDownloadFolder('~/notes', '/home/u').path === '/home/u/notes', 'the home folder is expanded');
assert(parseDownloadFolder('C:\\notes', '/home/u').kind === 'absolute', 'Windows paths are absolute');
assert(JSON.stringify(subfolderSegments(' services/../account\\x/ ')) === JSON.stringify(['services', 'account', 'x']), 'subfolders cannot climb up');

console.log('PASS: file names ok');
