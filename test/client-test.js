const { parseJiraUrl, isCloud, authFor, authHeader, apiRoot, issueWebUrl } = require('../src/jiraClient');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const cloud = parseJiraUrl('https://acme.atlassian.net/browse/PROJ-123?focusedCommentId=1');
assert(cloud && cloud.issueKey === 'PROJ-123' && isCloud(cloud.site), 'cloud browse link parsed');
assert(apiRoot(cloud.site) === 'https://acme.atlassian.net/rest/api/2', 'cloud api root');
assert(issueWebUrl(cloud.site, 'PROJ-1') === 'https://acme.atlassian.net/browse/PROJ-1', 'issue web url');

const board = parseJiraUrl('https://acme.atlassian.net/jira/software/c/projects/PROJ/boards/7?selectedIssue=PROJ-9');
assert(board && board.issueKey === 'PROJ-9' && board.site.basePath === '', 'board link with selectedIssue');

const issues = parseJiraUrl('https://acme.atlassian.net/jira/software/projects/PROJ/issues/PROJ-44');
assert(issues && issues.issueKey === 'PROJ-44', 'cloud project issues link');

const server = parseJiraUrl('https://intranet.acme.com/jira/browse/ABC-7');
assert(server && server.issueKey === 'ABC-7' && !isCloud(server.site), 'server link parsed');
assert(apiRoot(server.site) === 'https://intranet.acme.com/jira/rest/api/2', 'context path taken from the link');

const serverProject = parseJiraUrl('https://intranet.acme.com/jira/projects/ABC/issues/ABC-8');
assert(serverProject.issueKey === 'ABC-8' && serverProject.site.basePath === '/jira', 'server project issues link with context path');

const project = parseJiraUrl('https://acme.atlassian.net/browse/PROJ');
assert(project && project.projectKey === 'PROJ' && !project.issueKey, 'project browse link');
const projectBoard = parseJiraUrl('https://acme.atlassian.net/jira/software/projects/PROJ/boards/1');
assert(projectBoard && projectBoard.projectKey === 'PROJ', 'project board link');

const port = parseJiraUrl('https://jira.example.com:8443/browse/X-1');
assert(port.site.origin === 'https://jira.example.com:8443', 'non-standard port kept');

assert(parseJiraUrl('https://example.com/anything') === null, 'link without an issue rejected');
assert(parseJiraUrl('not-a-url') === null, 'garbage rejected');

assert(authHeader(authFor(server.site, 'PAT', 'a@b.com')) === 'Bearer PAT', 'server/DC sends the PAT as Bearer');
const basic = authHeader(authFor(cloud.site, 'T', 'a@b.com'));
assert(basic.startsWith('Basic ') && Buffer.from(basic.slice(6), 'base64').toString() === 'a@b.com:T', 'cloud -> Basic email:token');

console.log('PASS: jira client (url parsing, auth) ok');
