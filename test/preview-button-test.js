const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };
const MarkdownIt = require('markdown-it');
const { previewButtons, actionLink, fileUriCandidates } = require('../src/previewButton');

const md = previewButtons(new MarkdownIt({ html: true }),
  { uriScheme: 'vscode', extensionId: 'beatahumeniuk.jira-to-md' });
const doc = { scheme: 'file', toString: () => 'file:///w/jira/PROJ-12-add-2fa.md' };
const BOUND = '---\njira:\n  url: https://acme.atlassian.net/browse/PROJ-12\n  updated: 2026-09-25T10:00:00.000+0000\n---\n\n# Title\n\nBody.\n';

const html = md.render(BOUND, { currentDocument: doc });
assert(html.indexOf('<div class="jira-to-md-actions">') === 0, 'a bound file starts with the buttons, got: ' + html);
assert(html.includes('href="vscode://beatahumeniuk.jira-to-md/pull?file=file%3A%2F%2F%2Fw%2Fjira%2FPROJ-12-add-2fa.md"'),
  'the pull button links back to the extension with the previewed file');
assert(html.includes('/push?file='), 'there is a push button');
assert(html.includes('PROJ-12'), 'the tooltip names the issue');
assert(html.includes('<h1>Title</h1>'), 'the file itself still renders');

assert(!md.render('# Title\n', { currentDocument: doc }).includes('jira-to-md-actions'), 'no front matter, no buttons');
assert(!md.render('---\nconfluence:\n  url: https://x/pages/1\n  version: 1\n---\n# T\n', { currentDocument: doc }).includes('jira-to-md-actions'),
  'a Confluence binding is not a Jira binding');
assert(!md.render(BOUND, {}).includes('jira-to-md-actions'), 'no buttons when the preview does not say which file it shows');

const link = actionLink('vscode', 'a.b', 'pull', 'file:///x/a&b.md');
assert(fileUriCandidates(link.split('?')[1]).includes('file:///x/a&b.md'), 'the file round-trips through an encoded query');

console.log('PASS: preview button ok');
