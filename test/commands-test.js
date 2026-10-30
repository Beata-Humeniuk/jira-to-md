const assert = (ok, name) => { if (!ok) { console.error('FAIL: ' + name); process.exit(1); } };

const disk = new Map();
const info = [];
const errors = [];
const warnings = [];
const answers = {};
let settings = {};
let folderSettings = {};
let routes = [];
let docs = [];

function uri(path) {
  return {
    scheme: 'file', authority: '', path, fsPath: path,
    toString: () => 'file://' + path.split('/').map(encodeURIComponent).join('/')
  };
}

function joinPath(base, ...parts) {
  const out = [];
  for (const segment of (base.path + '/' + parts.join('/')).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return uri('/' + out.join('/'));
}

function openDoc(path, dirty) {
  const doc = {
    uri: uri(path),
    fileName: path,
    isDirty: !!dirty,
    saved: 0,
    getText: () => disk.get(path),
    positionAt: (offset) => offset,
    save: async () => { doc.saved++; doc.isDirty = false; return true; }
  };
  docs.push(doc);
  return doc;
}

function WorkspaceEdit() { this.edits = []; }
WorkspaceEdit.prototype.replace = function (target, range, text) { this.edits.push({ target, range, text }); };

const vscodeStub = {
  Uri: { file: uri, joinPath, parse: (t) => uri(t.slice('file://'.length).split('/').map(decodeURIComponent).join('/')) },
  Range: function Range(start, end) { this.start = start; this.end = end; },
  WorkspaceEdit,
  ProgressLocation: { Notification: 15 },
  FileType: { File: 1, Directory: 2 },
  window: {
    activeTextEditor: null,
    showInformationMessage: (message) => { info.push(message); },
    showErrorMessage: (message) => { errors.push(message); },
    showWarningMessage: async (message) => { warnings.push(message); return answers.warning; },
    showInputBox: async () => answers.input,
    showQuickPick: async (items) => answers.pick(items),
    showTextDocument: async () => {},
    withProgress: (options, task) => task()
  },
  workspace: {
    get textDocuments() { return docs; },
    openTextDocument: async (target) => {
      const open = docs.find((d) => d.uri.path === target.path);
      if (open) return open;
      if (!disk.has(target.path)) throw new Error('cannot open ' + target.path);
      return openDoc(target.path);
    },
    applyEdit: async (edit) => {
      for (const e of edit.edits) {
        const text = disk.get(e.target.path);
        disk.set(e.target.path, text.slice(0, e.range.start) + e.text + text.slice(e.range.end));
      }
      return true;
    },
    asRelativePath: (target) => target.path.replace(/^\/w\//, ''),
    getConfiguration: (section, resource) => ({
      get: (key) => Object.assign({ token: 'T', email: 'a@b.com' }, settings, resource ? folderSettings : {})[key]
    }),
    fs: {
      stat: async (target) => {
        if (!disk.has(target.path)) throw new Error('EntryNotFound');
        return {};
      },
      readFile: async (target) => {
        if (!disk.has(target.path)) throw new Error('EntryNotFound: ' + target.path);
        return Buffer.from(disk.get(target.path), 'utf8');
      },
      writeFile: async (target, bytes) => { disk.set(target.path, Buffer.from(bytes).toString('utf8')); },
      createDirectory: async () => {},
      readDirectory: async (folder) => {
        const prefix = folder.path.replace(/\/+$/, '') + '/';
        const entries = new Map();
        for (const path of disk.keys()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length).split('/');
          entries.set(rest[0], rest.length > 1 ? 2 : 1);
        }
        if (!entries.size) throw new Error('EntryNotFound');
        return Array.from(entries);
      }
    },
    getWorkspaceFolder: () => null,
    workspaceFolders: [{ uri: uri('/w') }]
  },
  commands: { executeCommand: async () => {} }
};

const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? 'vscode' : resolve.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub, children: [], paths: [] };

const sent = [];
global.fetch = async (url, options) => {
  const method = (options && options.method) || 'GET';
  const raw = options && options.body;
  const body = raw instanceof FormData
    ? await Promise.all(raw.getAll('file').map(async (f) => ({ name: f.name, text: await f.text() })))
    : raw ? JSON.parse(raw) : null;
  sent.push({ method, url: decodeURIComponent(url), body, headers: (options && options.headers) || {} });
  const route = routes.find((r) => (r.method || 'GET') === method && decodeURIComponent(url).indexOf(r.match) >= 0);
  const status = route ? (route.status || 200) : 404;
  const reply = route && (typeof route.body === 'function' ? route.body(body) : route.body);
  return {
    ok: status < 300, status, url, json: async () => reply || {},
    arrayBuffer: async () => new TextEncoder().encode(String(reply)).buffer
  };
};

const { fetchIssueCommand } = require('../src/fetchCommand');
const { pullIssueCommand } = require('../src/pullCommand');
const { publishIssueCommand } = require('../src/publishCommand');
const { handlePreviewUri } = require('../src/previewActions');

function reset() {
  disk.clear();
  info.length = 0;
  errors.length = 0;
  warnings.length = 0;
  sent.length = 0;
  routes = [];
  docs = [];
  settings = { downloadFolder: 'jira', descriptionFormat: 'wiki' };
  folderSettings = {};
  vscodeStub.window.activeTextEditor = null;
  answers.input = undefined;
  answers.warning = undefined;
  answers.pick = (items) => items.filter((i) => i.picked);
}

const SITE = 'https://acme.atlassian.net';
const EPIC_TYPE = { name: 'Epic', hierarchyLevel: 1 };

function issue(key, fields) {
  return {
    key,
    fields: Object.assign({
      summary: 'Summary of ' + key, description: '', updated: '2026-09-01T10:00:00.000+0000',
      issuetype: { name: 'Story' }, status: { name: 'To Do' }, project: { key: 'PROJ' }
    }, fields)
  };
}

const EPIC = issue('PROJ-1', { summary: 'Login rework', issuetype: EPIC_TYPE });
const STORY = issue('PROJ-2', {
  summary: 'Add two-factor login',
  description: 'h2. Why\nUsers need *stronger* logins.\n\nh2. What Changes\n* Add a TOTP step',
  parent: { key: 'PROJ-1', fields: { issuetype: EPIC_TYPE } }
});
const TASK = issue('PROJ-3', { summary: 'Store TOTP secrets', issuetype: { name: 'Task' } });
const STORY_FILE = '/w/jira/PROJ-2_Add_two-factor_login.md';
const STORY_PKG_FILE = '/w/jira/PROJ-2_Add_two-factor_login/PROJ-2_Add_two-factor_login.md';

function epicRoutes() {
  return [
    { match: '/rest/api/2/issue/PROJ-1?', body: EPIC },
    { match: '/rest/api/2/search/jql?jql=parent = PROJ-1', body: { issues: [STORY, TASK], isLast: true } }
  ];
}

async function main() {
  reset();
  routes = epicRoutes();
  answers.input = SITE + '/browse/PROJ-1';
  let offered = [];
  answers.pick = (items) => { offered = items; return items.filter((i) => i.picked && i.issue.key !== 'PROJ-1'); };
  await fetchIssueCommand();
  assert(!errors.length, 'no errors, got: ' + errors.join(' | '));
  assert(offered.length === 3 && offered.every((i) => i.picked), 'the epic and its issues are offered, all preselected');
  const EPIC_PKG = '/w/jira/PROJ-1_Login_rework/';
  const story = disk.get(EPIC_PKG + 'PROJ-2_Add_two-factor_login.md');
  assert(story, 'the story is saved in the epic\'s package folder, got: ' + Array.from(disk.keys()).join(', '));
  assert(story.startsWith('---\njira:\n  url: ' + SITE + '/browse/PROJ-2\n  updated: 2026-09-01T10:00:00.000+0000\nkey: PROJ-2\n'),
    'the file is bound to the issue, got:\n' + story);
  assert(story.includes('epic: PROJ-1') && story.includes('generator: jira-to-md@'), 'the epic and the generator are recorded');
  assert(story.includes('# Add two-factor login\n\n## Why\n\nUsers need **stronger** logins.\n\n## What Changes\n\n- Add a TOTP step\n'),
    'the description is converted to Markdown, got:\n' + story);
  assert(disk.get(EPIC_PKG + 'PROJ-3_Store_TOTP_secrets.md').includes('# Store TOTP secrets'), 'the task is saved next to it');
  assert(!disk.has(EPIC_PKG + 'PROJ-1_Login_rework.md'), 'the unpicked epic is not saved');
  assert(info.some((m) => m.includes('Saved 2 issues to jira/')), 'a summary, got: ' + info.join(' | '));

  reset();
  disk.set('/w/jira/auth/old-name.md', '---\njira:\n  url: ' + SITE + '/browse/PROJ-2\n  updated: x\n---\n\n# Old\n');
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  answers.input = SITE + '/browse/PROJ-2';
  answers.pick = () => { throw new Error('no picker for a single issue'); };
  await fetchIssueCommand();
  assert(!errors.length && !warnings.length, 'a single issue is saved without prompts, got: ' + errors.join(' | '));
  assert(disk.get('/w/jira/auth/old-name.md').includes('# Add two-factor login') && !disk.has(STORY_FILE),
    'downloading again refreshes the file already bound to the issue');

  reset();
  disk.set(STORY_PKG_FILE, '## Local draft\n');
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  answers.input = SITE + '/browse/PROJ-2';
  await fetchIssueCommand();
  assert(warnings.length === 1 && disk.get(STORY_PKG_FILE).includes('Local draft'), 'declining keeps a local file of the same name');

  reset();
  disk.set('/w/jira/PROJ-1_Old_name/PROJ-1_Old_name.md', '---\njira:\n  url: ' + SITE + '/browse/PROJ-1\n  updated: x\n---\n\n# Old\n');
  routes = epicRoutes();
  answers.input = SITE + '/browse/PROJ-1';
  answers.pick = (items) => items;
  await fetchIssueCommand();
  assert(!errors.length && disk.get('/w/jira/PROJ-1_Old_name/PROJ-1_Old_name.md').includes('# Login rework') &&
    disk.has('/w/jira/PROJ-1_Old_name/PROJ-3_Store_TOTP_secrets.md'),
  'new issues of an epic join the folder the epic is already saved in, got: ' + Array.from(disk.keys()).join(', '));

  reset();
  settings = { downloadFolder: '' };
  vscodeStub.window.activeTextEditor = { document: openDoc('/w/docs/notes.md') };
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  answers.input = SITE + '/browse/PROJ-2';
  await fetchIssueCommand();
  assert(!errors.length && disk.has('/w/docs/PROJ-2_Add_two-factor_login/PROJ-2_Add_two-factor_login.md'),
    'an empty download folder means the active file\'s folder, got: ' + Array.from(disk.keys()).join(', '));

  reset();
  settings = { downloadFolder: '' };
  folderSettings = { downloadFolder: 'specs/jira' };
  vscodeStub.window.activeTextEditor = { document: openDoc('/w/docs/notes.md') };
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  answers.input = SITE + '/browse/PROJ-2';
  await fetchIssueCommand();
  assert(!errors.length && disk.has('/w/specs/jira/PROJ-2_Add_two-factor_login/PROJ-2_Add_two-factor_login.md'),
    'a download folder set in the folder\'s settings is used, got: ' + Array.from(disk.keys()).join(', '));

  reset();
  settings = { downloadFolder: 'jira', askSubfolder: true };
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  const inputs = ['services/../account', SITE + '/browse/PROJ-2'];
  const prompts = [];
  vscodeStub.window.showInputBox = async (options) => { prompts.push(options.prompt); return inputs.shift(); };
  await fetchIssueCommand();
  vscodeStub.window.showInputBox = async () => answers.input;
  assert(prompts[0].includes('subfolder of jira'), 'the subfolder is asked for, got: ' + prompts.join(' | '));
  assert(!errors.length && disk.has('/w/jira/services/account/PROJ-2_Add_two-factor_login/PROJ-2_Add_two-factor_login.md'),
    'the issue goes to the subfolder, got: ' + Array.from(disk.keys()).join(', '));

  reset();
  const LOCAL = '---\njira:\n  url: ' + SITE + '/browse/PROJ-2\n  updated: 2026-09-01T10:00:00.000+0000\nkey: PROJ-2\n' +
    'owner: team-auth\ngenerated: 2026-01-01\n---\n\n# Add two-factor login\n\nOld body.\n';
  const FILE = STORY_FILE;
  disk.set(FILE, LOCAL);
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: issue('PROJ-2', Object.assign({}, STORY.fields, {
    updated: '2026-09-20T08:00:00.000+0000', description: 'New *body*.'
  })) }];
  answers.warning = 'Pull';
  await pullIssueCommand(uri(FILE));
  let text = disk.get(FILE);
  assert(!errors.length, 'no pull errors, got: ' + errors.join(' | '));
  assert(warnings.length === 1 && warnings[0].includes('2026-09-20'), 'the user is asked first');
  assert(text.includes('  updated: 2026-09-20T08:00:00.000+0000\n'), 'the binding moves to the pulled timestamp');
  assert(text.includes('New **body**.') && !text.includes('Old body'), 'content is replaced');
  assert(text.includes('owner: team-auth') && !text.includes('generated: 2026-01-01'), 'custom keys survive, generated ones refresh');
  assert(docs[0].saved === 1, 'the document is saved');

  reset();
  disk.set(FILE, LOCAL);
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: STORY }];
  await pullIssueCommand(uri(FILE));
  assert(!warnings.length && info.some((m) => m.includes('Already up to date')), 'up to date, no prompt');

  reset();
  disk.set(FILE, LOCAL.replace('Old body.', 'Users need **MFA**.\n\n- [ ] 1.1 Add TOTP'));
  let current = STORY;
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: () => ({ fields: { updated: '2026-09-25T12:00:00.000+0000' } }) },
    { match: '/rest/api/2/issue/PROJ-2?', body: () => current },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  await publishIssueCommand(uri(FILE));
  const put = sent.find((r) => r.method === 'PUT');
  assert(!errors.length && put, 'the issue is updated, got: ' + errors.join(' | '));
  assert(put.body.fields.summary === 'Add two-factor login', 'the H1 is the summary');
  assert(put.body.fields.description === 'Users need *MFA*.\n\n* [ ] 1.1 Add TOTP', 'the body is sent as wiki markup, got: ' + put.body.fields.description);
  assert(!put.body.update && Object.keys(put.body.fields).length === 2, 'only the summary and the description are sent');
  assert(disk.get(FILE).includes('  updated: 2026-09-25T12:00:00.000+0000\n'), 'the binding is refreshed');

  reset();
  disk.set(FILE, LOCAL);
  current = issue('PROJ-2', Object.assign({}, STORY.fields, { updated: '2026-09-24T00:00:00.000+0000' }));
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?', body: () => current },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  await publishIssueCommand(uri(FILE));
  assert(warnings.length === 1 && warnings[0].includes('changed in Jira'), 'a newer issue is called out');
  assert(!sent.some((r) => r.method === 'PUT'), 'declining leaves Jira alone');

  reset();
  const NEW = '/w/notes/audit-log.md';
  disk.set(NEW, '# Add an audit log\n\n## Why\n\nCompliance.\n');
  routes = [
    { match: '/rest/api/2/issue/PROJ-1?', body: EPIC },
    { method: 'POST', match: '/rest/api/2/issue', body: { id: '100', key: 'PROJ-50' } },
    { match: '/rest/api/2/issue/PROJ-50?fields=updated', body: { fields: { updated: '2026-09-25T13:00:00.000+0000' } } }
  ];
  answers.input = SITE + '/browse/PROJ-1';
  answers.pick = (items) => items[0];
  const result = await publishIssueCommand(uri(NEW));
  const post = sent.find((r) => r.method === 'POST');
  assert(!errors.length && post, 'the issue is created, got: ' + errors.join(' | '));
  assert(post.body.fields.project.key === 'PROJ' && post.body.fields.issuetype.name === 'Story' &&
    post.body.fields.parent.key === 'PROJ-1', 'in the epic\'s project, under the epic');
  assert(post.body.fields.description === 'h2. Why\n\nCompliance.' && !post.body.fields.labels, 'with the file as description and no labels');
  assert(result && result.key === 'PROJ-50' && result.action === 'created', 'the result names the new issue');
  assert(disk.get(NEW).startsWith('---\njira:\n  url: ' + SITE + '/browse/PROJ-50\n  updated: 2026-09-25T13:00:00.000+0000\n---\n\n# Add an audit log'),
    'the file is bound to the new issue, got:\n' + disk.get(NEW));
  const pkgCopy = disk.get('/w/jira/PROJ-1_Login_rework/PROJ-50_Add_an_audit_log.md');
  assert(pkgCopy && pkgCopy.includes('url: ' + SITE + '/browse/PROJ-50') && pkgCopy.includes('epic: PROJ-1') &&
    pkgCopy.includes('# Add an audit log\n\n## Why\n\nCompliance.'),
  'a file from outside the download folder is also saved in the epic\'s package, got: ' + Array.from(disk.keys()).join(', '));
  assert(info.some((m) => m.includes('Saved to jira/PROJ-1_Login_rework/PROJ-50_Add_an_audit_log.md')), 'the copy is reported, got: ' + info.join(' | '));

  reset();
  disk.set(NEW, 'No heading here.\n');
  routes = [
    { match: '/rest/api/2/issue/PROJ-1?', body: EPIC },
    { method: 'POST', match: '/rest/api/2/issue', body: { id: '101', key: 'PROJ-51' } },
    { match: '/rest/api/2/issue/PROJ-51?fields=updated', body: { fields: { updated: '2026-09-25T13:00:00.000+0000' } } }
  ];
  answers.input = SITE + '/browse/PROJ-1';
  answers.pick = (items) => items[0];
  await publishIssueCommand(uri(NEW));
  const titled = sent.find((r) => r.method === 'POST');
  assert(titled && titled.body.fields.summary === 'audit-log', 'without a heading the file name is the summary');

  reset();
  settings = { downloadFolder: 'jira', descriptionFormat: 'wiki' };
  const SERVER = 'https://jira.acme.com/jira';
  const FIELDS = [{ id: 'customfield_10100', name: 'Epic Link', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } }];
  routes = [
    { match: SERVER + '/rest/api/2/field', body: FIELDS },
    { match: '/rest/api/2/issue/ABC-1?', body: issue('ABC-1', { issuetype: { name: 'Epic' } }) },
    { match: '/rest/api/2/search?jql="Epic Link" = ABC-1', body: {
      total: 1, issues: [issue('ABC-2', { summary: 'Add export', customfield_10100: 'ABC-1' })]
    } }
  ];
  answers.input = SERVER + '/browse/ABC-1';
  answers.pick = (items) => items.filter((i) => i.issue.key !== 'ABC-1');
  await fetchIssueCommand();
  assert(!errors.length, 'server epic downloads, got: ' + errors.join(' | '));
  const serverFile = disk.get('/w/jira/ABC-1_Summary_of_ABC-1/ABC-2_Add_export.md');
  assert(serverFile && serverFile.includes('url: ' + SERVER + '/browse/ABC-2') && serverFile.includes('epic: ABC-1'),
    'the epic link names the epic, got: ' + Array.from(disk.keys()).join(', '));
  assert(sent.every((r) => r.url.indexOf('/search/jql') < 0), 'server uses the classic search');

  reset();
  disk.set(FILE, LOCAL);
  const doc = openDoc(FILE, true);
  current = STORY;
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-09-25T12:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: () => current },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  const push = { path: '/push', query: 'file=' + encodeURIComponent(uri(FILE).toString()) };
  await handlePreviewUri(push);
  assert(!sent.some((r) => r.method === 'PUT') && doc.saved === 0, 'declined publish neither saves nor publishes');
  answers.warning = 'Publish';
  await handlePreviewUri(push);
  assert(doc.saved === 1 && sent.some((r) => r.method === 'PUT'), 'confirmed publish saves and publishes');
  assert(!errors.length, 'no errors on push, got: ' + errors.join(' | '));

  reset();
  disk.set(FILE, LOCAL);
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-09-25T12:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: STORY },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  answers.warning = 'Publish';
  await handlePreviewUri(push);
  assert(!errors.length && sent.some((r) => r.method === 'PUT'), 'a preview whose file is not open still pushes, got: ' + errors.join(' | '));
  reset();
  await handlePreviewUri({ path: '/push', query: 'file=' + encodeURIComponent(uri('/w/gone.md').toString()) });
  assert(errors.length === 1 && errors[0].includes('could not be opened'), 'a missing file is reported, got: ' + errors.join(' | '));

  reset();
  disk.set(FILE, LOCAL);
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?', body: STORY },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 400, body: { errorMessages: [], errors: { summary: 'Summary is required.' } } }
  ];
  await publishIssueCommand(uri(FILE)).catch((e) => errors.push(e.message));
  assert(errors.length === 1 && errors[0] === 'Jira: summary: Summary is required.', 'Jira errors are shown as sent, got: ' + errors.join(' | '));

  reset();
  settings = {};
  const RICH = issue('PROJ-8', { summary: 'Package change', description: '<h2 dir="auto">Zmiany</h2>\n<p>Stare.</p>' });
  const RICH_FILE = '/w/jira/PROJ-8_Package_change.md';
  disk.set(RICH_FILE, '---\njira:\n  url: ' + SITE + '/browse/PROJ-8\n  updated: 2026-09-01T10:00:00.000+0000\n---\n\n' +
    '# Package change\n\n## Zmiany w procesie:\n\n1. Zmiany w **response**\n');
  routes = [
    { match: '/rest/api/2/issue/PROJ-8?fields=updated', body: { fields: { updated: '2026-10-21T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-8?', body: RICH },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-8', status: 204 }
  ];
  await publishIssueCommand(uri(RICH_FILE));
  const richPut = sent.find((r) => r.method === 'PUT');
  assert(!errors.length && richPut && richPut.body.fields.description ===
    '<h2>Zmiany w procesie:</h2>\n<ol>\n<li>Zmiany w <strong>response</strong></li>\n</ol>',
  'by default the description is pushed as HTML, got: ' + errors.join(' | ') + JSON.stringify(richPut && richPut.body));

  reset();
  settings = { descriptionFormat: 'auto' };
  disk.set(FILE, LOCAL.replace('Old body.', 'Users need **MFA**.'));
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-10-21T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: STORY },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  await publishIssueCommand(uri(FILE));
  const autoPut = sent.find((r) => r.method === 'PUT');
  assert(autoPut && autoPut.body.fields.description === 'Users need *MFA*.',
    'auto follows a wiki description, got: ' + JSON.stringify(autoPut && autoPut.body));

  reset();
  settings = {};
  const LINKED_FILE = '/w/jira/PROJ-8_Package_change/PROJ-8_Package_change.md';
  const LINKED = '---\njira:\n  url: ' + SITE + '/browse/PROJ-8\n  updated: 2026-09-01T10:00:00.000+0000\n---\n\n' +
    '# Package change\n\nSee [the config](./conf/config.ts), [the old one](./conf/old.ts), [secrets](./.env), ' +
    '[outside](../../elsewhere.ts) and [missing](./nope.ts).\n';
  disk.set(LINKED_FILE, LINKED);
  disk.set('/w/jira/PROJ-8_Package_change/conf/config.ts', 'export const a = 1;');
  disk.set('/w/jira/PROJ-8_Package_change/conf/old.ts', 'old');
  disk.set('/w/jira/PROJ-8_Package_change/.env', 'TOKEN=x');
  disk.set('/w/elsewhere.ts', 'outside');
  const OLD = { id: '9', filename: 'old.ts', size: 3, content: SITE + '/secure/attachment/9/old.ts' };
  const STALE = { id: '8', filename: 'config.ts', size: 19, content: SITE + '/secure/attachment/8/config.ts' };
  const CONFIG = { id: '10', filename: 'config.ts', size: 19, content: SITE + '/secure/attachment/10/config.ts' };
  routes = [
    { match: '/rest/api/2/issue/PROJ-8?fields=updated', body: { fields: { updated: '2026-10-28T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-8?fields=attachment', body: { fields: { attachment: [STALE, OLD] } } },
    { match: '/rest/api/2/issue/PROJ-8?', body: RICH },
    { match: '/secure/attachment/8/config.ts', body: 'export const a = 2;' },
    { match: '/secure/attachment/9/old.ts', body: 'old' },
    { method: 'POST', match: '/rest/api/2/issue/PROJ-8/attachments', body: [CONFIG] },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-8', status: 204 }
  ];
  await publishIssueCommand(uri(LINKED_FILE));
  const uploads = sent.filter((r) => r.method === 'POST');
  const linkedPut = sent.find((r) => r.method === 'PUT');
  assert(!errors.length && uploads.length === 1 && uploads[0].body.length === 1 &&
    uploads[0].body[0].name === 'config.ts' && uploads[0].body[0].text === 'export const a = 1;' &&
    uploads[0].headers['X-Atlassian-Token'] === 'no-check',
  'a changed linked file is uploaded once; same content is reused, hidden and outside files are not, got: ' +
    errors.join(' | ') + JSON.stringify(uploads.map((u) => u.body)));
  const linkedHtml = linkedPut.body.fields.description;
  assert(linkedHtml.includes('<a href="' + CONFIG.content + '">the config</a>') &&
    linkedHtml.includes('<a href="' + OLD.content + '">the old one</a>') &&
    linkedHtml.includes('<a href="./.env">') && linkedHtml.includes('<a href="./nope.ts">'),
  'links point at the attachments, got: ' + linkedHtml);
  assert(info.some((m) => m.includes('Attached config.ts.')), 'the upload is reported, got: ' + info.join(' | '));

  reset();
  disk.set(LINKED_FILE, LINKED);
  const linkedIssue = issue('PROJ-8', { summary: 'Package change', description: linkedHtml, attachment: [CONFIG, OLD],
    updated: '2026-10-28T09:00:00.000+0000' });
  routes = [{ match: '/rest/api/2/issue/PROJ-8?', body: linkedIssue }];
  answers.warning = 'Pull';
  await pullIssueCommand(uri(LINKED_FILE));
  const pulled = disk.get(LINKED_FILE);
  assert(!errors.length && pulled.includes('See [the config](./conf/config.ts), [the old one](./conf/old.ts), [secrets](./.env)'),
    'after a pull the links lead to the local files again, got:\n' + pulled);

  reset();
  const GUIDE = '/w/docs/guide/login.md';
  const GUIDE_TEXT = '---\nconfluence:\n  url: https://acme.atlassian.net/wiki/spaces/DOC/pages/77\n  version: 4\ntype: confluence-page\n---\n\n' +
    '# Login guide\n\nUse [the config](./conf/login.ts).\n';
  const DOWNLOADED = '/w/jira/PROJ-1_Login_rework/PROJ-2_Add_two-factor_login.md';
  disk.set(GUIDE, GUIDE_TEXT);
  disk.set(DOWNLOADED, '---\njira:\n  url: ' + SITE + '/browse/PROJ-2\n  updated: 2026-09-01T10:00:00.000+0000\nkey: PROJ-2\nowner: team-auth\n---\n\n# Add two-factor login\n');
  const EMPTY = issue('PROJ-2', Object.assign({}, STORY.fields, { description: '' }));
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-10-29T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: EMPTY },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  answers.input = SITE + '/browse/PROJ-2';
  await publishIssueCommand(uri(GUIDE));
  assert(warnings.length === 1 && warnings[0].includes('PROJ-2 "Add two-factor login"') && warnings[0].includes('description is empty'),
    'publishing an unbound file to an issue link asks first, got: ' + warnings.join(' | '));
  assert(!sent.some((r) => r.method === 'PUT') && disk.get(GUIDE) === GUIDE_TEXT, 'declining changes nothing');
  answers.warning = 'Replace the description';
  const replaced = await publishIssueCommand(uri(GUIDE));
  const replacePut = sent.find((r) => r.method === 'PUT');
  assert(!errors.length && replaced && replaced.key === 'PROJ-2' && replaced.action === 'updated',
    'the existing issue is updated, got: ' + errors.join(' | '));
  assert(Object.keys(replacePut.body.fields).join() === 'description' && replacePut.body.fields.description.includes('Use [the config|'),
    'only the description is replaced, got: ' + JSON.stringify(replacePut.body));
  let guide = disk.get(GUIDE);
  assert(guide.startsWith('---\njira:\n  url: ' + SITE + '/browse/PROJ-2\n  updated: 2026-10-29T09:00:00.000+0000\n  keepSummary: true\n' +
    'confluence:\n  url: https://acme.atlassian.net/wiki/spaces/DOC/pages/77\n  version: 4\ntype: confluence-page\n---\n\n# Login guide\n'),
  'the file is bound to the issue next to its Confluence binding, got:\n' + guide);
  const refreshed = disk.get(DOWNLOADED);
  assert(refreshed.includes('updated: 2026-10-29T09:00:00.000+0000') && refreshed.includes('owner: team-auth') &&
    !refreshed.includes('confluence:') && refreshed.includes('# Add two-factor login\n\nUse [the config](../../docs/guide/conf/login.ts).'),
  'the downloaded issue file gets the content, with links to the same files, got:\n' + refreshed);
  assert(Array.from(disk.keys()).filter((k) => k.startsWith('/w/jira/')).length === 1, 'no second file is made in the package');

  reset();
  disk.set(GUIDE, guide.replace('Use [the config]', 'Now use [the config]'));
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-10-29T10:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: issue('PROJ-2', Object.assign({}, STORY.fields, { updated: '2026-10-29T09:00:00.000+0000' })) },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  await publishIssueCommand(uri(GUIDE));
  const again = sent.find((r) => r.method === 'PUT');
  assert(!errors.length && !warnings.length && Object.keys(again.body.fields).join() === 'description',
    'a bound file keeps the issue summary on later publishes, without asking, got: ' + JSON.stringify(again && again.body));
  assert(disk.get(GUIDE).includes('  keepSummary: true\n') && disk.get(GUIDE).includes('  version: 4\n'), 'both bindings stay');

  reset();
  disk.set(GUIDE, guide);
  routes = [{ match: '/rest/api/2/issue/PROJ-2?', body: issue('PROJ-2', Object.assign({}, STORY.fields, {
    updated: '2026-10-30T09:00:00.000+0000', description: 'Edited *in Jira*.' })) }];
  answers.warning = 'Pull';
  await pullIssueCommand(uri(GUIDE));
  guide = disk.get(GUIDE);
  assert(!errors.length && guide.includes('# Login guide\n\nEdited **in Jira**.') && guide.includes('confluence:\n  url:'),
    'a pull keeps the file\'s own title and its Confluence binding, got:\n' + guide);

  reset();
  disk.set(NEW, '# Add an audit log\n\nBody.\n');
  routes = [
    { match: '/rest/api/2/issue/PROJ-1?fields=updated', body: { fields: { updated: '2026-10-29T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-1?', body: EPIC },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-1', status: 204 }
  ];
  answers.input = SITE + '/browse/PROJ-1';
  let epicChoices = [];
  answers.pick = (items) => { epicChoices = items; return items[1]; };
  answers.warning = 'Replace the description and the summary';
  await publishIssueCommand(uri(NEW));
  const epicPut = sent.find((r) => r.method === 'PUT');
  assert(epicChoices.length === 2 && epicChoices[0].label.includes('Create a new issue in epic PROJ-1') &&
    epicChoices[1].label.includes('Replace the description of epic PROJ-1'), 'an epic link offers both, got: ' + JSON.stringify(epicChoices));
  assert(!errors.length && epicPut && epicPut.body.fields.summary === 'Add an audit log' && !sent.some((r) => r.method === 'POST'),
    'the epic\'s summary and description are replaced, got: ' + errors.join(' | '));
  assert(!disk.get(NEW).includes('keepSummary'), 'replacing the summary too needs no flag');
  assert(disk.has('/w/jira/PROJ-1_Add_an_audit_log/PROJ-1_Add_an_audit_log.md'), 'the epic gets its package, got: ' + Array.from(disk.keys()).join(', '));

  reset();
  settings = { downloadFolder: '', descriptionFormat: 'wiki' };
  disk.set(NEW, '# Add an audit log\n\nBody.\n');
  routes = [
    { match: '/rest/api/2/issue/PROJ-2?fields=updated', body: { fields: { updated: '2026-10-29T09:00:00.000+0000' } } },
    { match: '/rest/api/2/issue/PROJ-2?', body: STORY },
    { method: 'PUT', match: '/rest/api/2/issue/PROJ-2', status: 204 }
  ];
  answers.input = SITE + '/browse/PROJ-2';
  answers.warning = 'Replace the description';
  await publishIssueCommand(uri(NEW));
  assert(!errors.length && warnings[0].includes('current description is replaced') && disk.size === 1,
    'without a download folder nothing is copied, got: ' + Array.from(disk.keys()).join(', '));

  const { rebaseLinks } = require('../src/attachments');
  assert(rebaseLinks('[a](./x/a.ts#L1) ![i](img.png "t") [w](https://x.y/a) [h](#top)', '/w/docs', '/w/jira/P') ===
    '[a](../../docs/x/a.ts#L1) ![i](../../docs/img.png "t") [w](https://x.y/a) [h](#top)', 'relative links follow a copied file');

  const { relinkLocalFiles } = require('../src/attachments');
  assert(relinkLocalFiles('[cfg|^config.ts] and [^old.ts] and [x|^other.ts]', [], '[a](./conf/config.ts) [b](./conf/old.ts)') ===
    '[cfg](./conf/config.ts) and [old.ts](./conf/old.ts) and [x|^other.ts]', 'wiki attachment links go back to local files');

  console.log('PASS: download, pull and push commands ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
