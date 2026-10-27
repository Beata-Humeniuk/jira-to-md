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
assert(html.includes('<table class="confluenceTable" style="border-collapse:collapse" border="1">') &&
  /<th class="confluenceTh" style="border:1px solid [^"]*padding:4px 8px/.test(html) && /<td class="confluenceTd" style="border:1px solid/.test(html),
  'tables carry borders and padding for the Jira editor, got:\n' + html);
assert(mdToHtml('| a |\n|--:|\n| 1 |').includes('text-align:right"'), 'column alignment still wins');
assert(mdToHtml('') === '' && mdToHtml('<b>x</b>') === '<p><b>x</b></p>', 'raw HTML in Markdown goes to Jira as HTML');

const ALERT = '> [!WARNING] UWAGA\n> Implementacja **później**.\n>\n> Drugi akapit\n\n> [!NOTE]\n> hi\n';
const alertHtml = mdToHtml(ALERT);
assert(alertHtml.startsWith('<blockquote class="jira-to-md-alert-warning" style="border-left:4px solid') &&
  alertHtml.includes('<p><strong>UWAGA</strong></p>\n<p>Implementacja <strong>później</strong>.</p>') &&
  alertHtml.includes('<p><strong>Note</strong></p>\n<p>hi</p>') && !alertHtml.includes('[!'), 'alerts become titled panels, got:\n' + alertHtml);
assert(htmlToMd(alertHtml) === ALERT, 'alerts read back as alerts, got:\n' + htmlToMd(alertHtml));

const RICH = '| a | b |\n| --- | --- |\n| x | <p>Podczas</p><ul><li data-uuid="1">wartość pola</li></ul> |\n';
const richHtml = mdToHtml(RICH);
assert(richHtml.includes('<p>Podczas</p><ul><li data-uuid="1">wartość pola</li></ul></td>'), 'HTML in a table cell stays HTML, got:\n' + richHtml);
assert(htmlToMd(richHtml) === RICH, 'cells with lists read back as HTML, got:\n' + htmlToMd(richHtml));

const MERGED = '| a | b | c |\n| --- | --- | --- |\n| x | y | 1 |\n| p | ^^ | 2 |\n| q | ^^ | 3 |\n| ^^ | r | 4 |\n';
const mergedHtml = mdToHtml(MERGED).replace(/ class="[^"]*" style="[^"]*"/g, '');
assert(mergedHtml.includes('<td>x</td>\n<td rowspan="3">y</td>\n<td>1</td>\n</tr>\n<tr>\n<td>p</td>\n<td>2</td>') &&
  mergedHtml.includes('<td rowspan="2">q</td>') && !mergedHtml.includes('^^'), '^^ cells merge into the cell above, got:\n' + mergedHtml);
assert(htmlToMd(mdToHtml(MERGED)) === MERGED, 'row spans read back as ^^, got:\n' + htmlToMd(mdToHtml(MERGED)));
const WIDE = '| Label | Przekierowanie |\n| --- | --- |\n| Nawigacja górna | << |\n| >> | Lista |\n| a | b |\n';
const wideHtml = mdToHtml(WIDE).replace(/ class="[^"]*" style="[^"]*"/g, '');
assert(wideHtml.includes('<td colspan="2">Nawigacja górna</td>\n</tr>') && wideHtml.includes('<td colspan="2">Lista</td>') &&
  !/<<|>>|&lt;&lt;|&gt;&gt;/.test(wideHtml), '<< and >> merge cells sideways, got:\n' + wideHtml);
assert(htmlToMd(mdToHtml(WIDE)) === WIDE.replace('| >> | Lista |', '| Lista | << |'), 'column spans read back as <<, got:\n' + htmlToMd(mdToHtml(WIDE)));
const UNDER = mdToHtml('| a | b | c |\n| --- | --- | --- |\n| wide | << | x |\n| ^^ | ^^ | y |\n').replace(/ class="[^"]*" style="[^"]*"/g, '');
assert(UNDER.includes('<td colspan="2" rowspan="2">wide</td>') && UNDER.includes('<td>y</td>'), '^^ under a wide cell stretches it once, got:\n' + UNDER);
const BOTH = '<table><tr><th rowspan="2" colspan="2">a</th><th>b</th></tr><tr><td>2 &amp; 3</td></tr></table>';
assert(htmlToMd(BOTH) === BOTH + '\n', 'a cell spanning rows and columns keeps the table HTML, got:\n' + htmlToMd(BOTH));
assert(mdToHtml(htmlToMd(BOTH)) === BOTH, 'and goes back to Jira unchanged');
assert(mdToWiki(MERGED).includes('| p |  | 2 |') && mdToWiki(WIDE).includes('| Nawigacja górna |  |'), 'wiki tables leave merged cells empty');

console.log('PASS: html -> markdown ok');
