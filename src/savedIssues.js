const vscode = require('vscode');
const { parseFrontMatter, frontMatterValue } = require('./frontMatter');
const { parseJiraUrl } = require('./jiraClient');

async function fileExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (e) {
    return false;
  }
}

const MAX_DEPTH = 3;

async function readSavedIssues(folder) {
  const out = [];
  await walk(folder, '', out, 0);
  return out;
}

async function walk(folder, dir, out, depth) {
  let entries;
  try {
    entries = await vscode.workspace.fs.readDirectory(folder);
  } catch (e) {
    return;
  }
  for (const [name, kind] of entries) {
    if (kind === vscode.FileType.Directory) {
      if (name[0] === '.' || name === 'node_modules' || depth >= MAX_DEPTH) continue;
      await walk(vscode.Uri.joinPath(folder, name), dir ? dir + '/' + name : name, out, depth + 1);
      continue;
    }
    if (kind !== vscode.FileType.File || !/\.md$/i.test(name)) continue;
    const uri = vscode.Uri.joinPath(folder, name);
    let text;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch (e) {
      continue;
    }
    const { meta, extraLines } = parseFrontMatter(text);
    const parsed = meta && parseJiraUrl(meta.url);
    out.push({
      uri,
      relPath: dir ? dir + '/' + name : name,
      key: meta ? ((parsed && parsed.issueKey) || frontMatterValue(extraLines, 'key')) : ''
    });
  }
}

async function confirmOverwrite(files) {
  const clashing = [];
  for (const file of files) {
    if (file.sameIssue) continue;
    if (await fileExists(file.uri)) clashing.push(file.relPath);
  }
  if (!clashing.length) return true;
  const overwrite = 'Overwrite';
  const picked = await vscode.window.showWarningMessage(
    'These files already exist and are not bound to the same issue: ' + clashing.join(', ') + '. Overwrite?',
    { modal: true }, overwrite);
  return picked === overwrite;
}

module.exports = { readSavedIssues, confirmOverwrite };
