const { htmlToMd, looksLikeHtml } = require('../src/htmlToMd');
const { mdToWiki } = require('../src/mdToWiki');
const { mdToHtml } = require('../src/mdToHtml');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const HTML = [
  '<h2 dir="auto">Zmiany w procesie:</h2>',
  '<h3 dir="auto">/api/account/package-change/email</h3>',
  '<h4 dir="auto">Wywołanie usługi&nbsp;Create_Email_V003</h4>',
  '<p dir="auto">Klient:&nbsp;[correspondence-as-client]<br>',
  'Operacja SOAP: Create_Email_V003</p>',
  '<ol dir="auto">',
  '  <li>Pobrać <strong>pierwszy</strong> element</li>',
  '  <li>Sprawdzić listę',
  '  <ol>',
  '    <li>jeśli brak&nbsp;isEmailAssent = true</li>',
  '    <li>w przeciwnym wypadku -&gt;&nbsp; <em>false</em></li>',
  '  </ol>',
  '  </li>',
  '</ol>',
  '<ul><li>a <a href="https://x.io/a b">link</a><li>b <code>x*y</code></ul>',
  '<p dir="auto">&nbsp;</p>',
  '<table><tr><th>a</th><th>b</th></tr><tr><td>1 | 2</td><td>3</td></tr></table>',
  '<pre><code class="language-json">{"a": 1 &lt; 2}\n</code></pre>',
  '<p>Plain &lt;tag&gt; and 2 * 3</p>'
].join('\n');

const md = htmlToMd(HTML);
const expected = [
  '## Zmiany w procesie:',
  '',
  '### /api/account/package-change/email',
  '',
  '#### Wywołanie usługi Create_Email_V003',
  '',
  'Klient: [correspondence-as-client]\\',
  'Operacja SOAP: Create_Email_V003',
  '',
  '1. Pobrać **pierwszy** element',
  '2. Sprawdzić listę',
  '   1. jeśli brak isEmailAssent = true',
  '   2. w przeciwnym wypadku -> _false_',
  '',
  '- a [link](https://x.io/a%20b)',
  '- b `x*y`',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 \\| 2 | 3 |',
  '',
  '```json',
  '{"a": 1 < 2}',
  '```',
  '',
  'Plain \\<tag> and 2 \\* 3',
  ''
].join('\n');
assert(md === expected, 'HTML becomes Markdown, got:\n' + md);

assert(looksLikeHtml(HTML), 'HTML descriptions are recognised');
assert(!looksLikeHtml('h2. Why\n* *bold* item\n{code}<b>x</b>{code}'), 'wiki markup is not taken for HTML');
assert(htmlToMd('') === '' && htmlToMd(null) === '', 'empty descriptions');
assert(mdToWiki(md).includes('# Pobrać *pierwszy* element\n# Sprawdzić listę\n## jeśli brak'), 'the Markdown pushes back to Jira as wiki markup');

const html = mdToHtml(md);
assert(html.startsWith('<h2>Zmiany w procesie:</h2>\n<h3>/api/account/package-change/email</h3>'), 'headings go out without anchors, got:\n' + html);
assert(!/<a name|<a id/.test(html), 'no anchors that the Jira editor shows as flags');
assert(looksLikeHtml(html) && htmlToMd(html) === md, 'the HTML reads back as the same Markdown, got:\n' + htmlToMd(html));
assert(mdToHtml('') === '' && mdToHtml('<b>x</b>') === '<p>&lt;b&gt;x&lt;/b&gt;</p>', 'raw HTML in Markdown is escaped');

console.log('PASS: html -> markdown ok');
