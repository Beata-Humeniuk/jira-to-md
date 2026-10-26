const vscode = require('vscode');
const { withNotification } = require('./progress');
const { parseJiraUrl } = require('./jiraClient');
const { contextAndIssue, loadEpicChildren } = require('./issues');
const { issueFileName, subfolderSegments } = require('./fileNames');
const { issueDocument } = require('./issueDocument');
const { readSavedIssues, confirmOverwrite } = require('./savedIssues');
const { downloadFolderUri, askSubfolder } = require('./config');
const { credentialsFor } = require('./credentials');
const { errorMessage } = require('./messages');

function issuesWord(n) {
  return n === 1 ? 'issue' : 'issues';
}

function pickItem(issue) {
  return {
    label: issue.key + '  ' + issue.summary,
    description: [issue.type, issue.status].filter(Boolean).join(' · '),
    issue,
    picked: true
  };
}

async function pickFromEpic(epic, children) {
  const picks = await vscode.window.showQuickPick(
    [pickItem(epic)].concat(children.map(pickItem)),
    {
      canPickMany: true,
      ignoreFocusOut: true,
      placeHolder: 'Epic ' + epic.key + ' has ' + children.length + ' ' + issuesWord(children.length) +
        ' — which ones should be saved as Markdown?'
    });
  return (picks || []).map((p) => p.issue);
}

async function targetFolder() {
  const folder = downloadFolderUri();
  if (!folder || !askSubfolder()) return folder;
  const sub = await vscode.window.showInputBox({
    prompt: 'Optional subfolder of ' + vscode.workspace.asRelativePath(folder, false) + ' — leave empty to save there',
    placeHolder: 'services/account',
    ignoreFocusOut: true
  });
  if (sub === undefined) return undefined;
  const segments = subfolderSegments(sub);
  return segments.length ? vscode.Uri.joinPath(folder, ...segments) : folder;
}

// New files go to the package folder of the downloaded issue (or epic); one already in a folder keeps it.
function packageFolder(top, known) {
  const existing = known.get(top.key);
  const dir = existing ? existing.split('/').slice(0, -1).join('/') : '';
  return dir || issueFileName(top.key, top.summary).replace(/\.md$/, '');
}

function filesFor(folder, top, selected, saved) {
  const known = new Map(saved.filter((s) => s.key).map((s) => [s.key, s.relPath]));
  const owners = new Map(saved.map((s) => [s.relPath, s.key]));
  const pkg = packageFolder(top, known);
  return selected.map((issue) => {
    const relPath = known.get(issue.key) || pkg + '/' + issueFileName(issue.key, issue.summary);
    const segments = relPath.split('/');
    return {
      relPath,
      key: issue.key,
      uri: vscode.Uri.joinPath(folder, ...segments),
      dirUri: vscode.Uri.joinPath(folder, ...segments.slice(0, -1)),
      sameIssue: owners.get(relPath) === issue.key,
      content: issueDocument(issue)
    };
  });
}

async function fetchIssueCommand() {
  const folder = await targetFolder();
  if (folder === undefined) return;
  if (!folder) {
    vscode.window.showErrorMessage('Open a file or a workspace folder first, or set jiraToMd.downloadFolder — issues are saved there.');
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt: 'Paste a link to a Jira issue — an epic downloads its stories and tasks too',
    placeHolder: 'https://…/browse/PROJ-123',
    ignoreFocusOut: true
  });
  if (!url) return;

  const parsed = parseJiraUrl(url);
  if (!parsed || !parsed.issueKey) {
    vscode.window.showErrorMessage(errorMessage(new Error('bad-url')));
    return;
  }
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  let issue;
  let children;
  try {
    ({ issue, children } = await withNotification('Downloading ' + parsed.issueKey + ' from Jira…', async () => {
      const { ctx, issue: found } = await contextAndIssue(creds, parsed.site, parsed.issueKey);
      return { issue: found, children: found.isEpic ? await loadEpicChildren(ctx, found.key) : [] };
    }));
  } catch (e) {
    vscode.window.showErrorMessage(errorMessage(e));
    return;
  }

  const selected = issue.isEpic ? await pickFromEpic(issue, children) : [issue];
  if (!selected.length) return;

  const files = filesFor(folder, issue, selected, await readSavedIssues(folder));
  if (!await confirmOverwrite(files)) return;
  for (const file of files) {
    await vscode.workspace.fs.createDirectory(file.dirUri);
    await vscode.workspace.fs.writeFile(file.uri, Buffer.from(file.content, 'utf8'));
  }

  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(files[0].uri), { preview: false });
  vscode.window.showInformationMessage(
    'Saved ' + files.length + ' ' + issuesWord(files.length) + ' to ' +
    vscode.workspace.asRelativePath(folder, false) + '/: ' +
    files.map((f) => f.key + ' → ' + f.relPath).join(', ') + '.');
}

module.exports = { fetchIssueCommand };
