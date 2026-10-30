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
assert(html.includes('/publish?file=') && html.includes('Publish to Jira') && html.includes('Pull from Jira'),
  'the buttons say what they do and where, got: ' + html);
assert(html.includes('PROJ-12'), 'the tooltip names the issue');
assert(html.includes('<h1>Title</h1>'), 'the file itself still renders');

const plain = md.render('# Title\n', { currentDocument: doc });
assert(plain.includes('/publish?file=') && plain.includes('Publish to Jira') && !plain.includes('/pull?'),
  'a file without a binding can only be published, got: ' + plain);
const confluence = md.render('---\nconfluence:\n  url: https://x/pages/1\n  version: 1\n---\n# T\n', { currentDocument: doc });
assert(!confluence.includes('/pull?') && confluence.includes('/publish?'), 'a Confluence binding is not a Jira binding');
const both = md.render('---\nconfluence:\n  url: https://x/pages/1\n  version: 1\njira:\n  url: https://acme.atlassian.net/browse/PROJ-7\n  updated: x\n---\n# T\n',
  { currentDocument: doc });
assert(both.includes('/pull?') && both.includes('Update this file from Jira issue PROJ-7'), 'a Jira binding next to a Confluence one is found');
assert(!md.render(BOUND, {}).includes('jira-to-md-actions'), 'no buttons when the preview does not say which file it shows');

const link = actionLink('vscode', 'a.b', 'pull', 'file:///x/a&b.md');
assert(fileUriCandidates(link.split('?')[1]).includes('file:///x/a&b.md'), 'the file round-trips through an encoded query');

console.log('PASS: preview button ok');
