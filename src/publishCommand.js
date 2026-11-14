const vscode = require('vscode');
const { withNotification } = require('./progress');
const { mdToWiki } = require('./mdToWiki');
const { mdToHtml } = require('./mdToHtml');
const { looksLikeHtml } = require('./htmlToMd');
const { parseFrontMatter, serializeFrontMatter } = require('./frontMatter');
const {
  parseJiraUrl, isCloud, issueWebUrl, fetchIssue, createIssue, updateIssue, uploadAttachment, downloadAttachment,
  deleteAttachment, fetchComments, addComment, updateComment
} = require('./jiraClient');
const { localTargets, rebaseLinks } = require('./attachments');
const { diagramsIn, withDiagramImages } = require('./mermaidImages');
const { renderDiagrams } = require('./mermaidRenderer');
const { contextAndIssue } = require('./issues');
const { issueFileName } = require('./fileNames');
const { publishedDocument, commentMarkdown } = require('./issueDocument');
const { splitSections, joinSections, shiftHeadings, commentHeading } = require('./sections');
const { readSavedIssues, confirmOverwrite } = require('./savedIssues');
const { credentialsFor } = require('./credentials');
const { errorMessage } = require('./messages');
const { descriptionFormat, packageRootUri, syncParts } = require('./config');

const ISSUE_TYPES = ['Story', 'Task'];
const PUBLISH = 'Publish';

function baseName(path) {
  return String(path || '').split(/[\\/]/).pop() || '';
}

function splitTitleAndBody(mdBody, fallbackTitle) {
  const h1 = mdBody.match(/^#[ \t]+(.+)\r?\n?/m);
  if (!h1) return { title: fallbackTitle, content: mdBody };
  return { title: h1[1].trim(), content: mdBody.replace(h1[0], '') };
}

// Jira fields edited in a rich-text editor store HTML. Wiki markup sent there gets an
// <a name> anchor per heading, which the editor shows as a flag, so such fields get HTML.
function descriptionFor(content, sample, links) {
  const format = descriptionFormat();
  const html = format === 'auto' ? looksLikeHtml(sample) : format === 'html';
  return html ? mdToHtml(content, links) : mdToWiki(content, links);
}

async function readLocalFile(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory) return null;
    return Buffer.from(await vscode.workspace.fs.readFile(uri));
  } catch (e) {
    return null;
  }
}

// A description can come from Jira, so only files inside the workspace folder are sent, and no
// hidden ones (.env, .ssh/…). The path is relative to the file `from` (the published one by default).
function attachableUri(source, path, from) {
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s[0] === '.' && s !== '.' && s !== '..')) return null;
  const folder = vscode.Uri.joinPath(source.uri, '..');
  const workspace = vscode.workspace.getWorkspaceFolder(source.uri);
  const root = (workspace ? workspace.uri : folder).path.replace(/\/+$/, '') + '/';
  const uri = vscode.Uri.joinPath(from ? vscode.Uri.joinPath(from, '..') : folder, ...segments);
  return uri.path.startsWith(root) ? uri : null;
}

// ```mermaid blocks become PNG attachments shown in their place, as Jira draws no Mermaid. A diagram
// is named after its source, so an unchanged one keeps its attachment and is not drawn again.
async function attachDiagrams(creds, site, key, diagrams, attachments, links) {
  const missing = diagrams.filter((d) => !attachments.some((a) => a.filename === d.name));
  const drawn = missing.length ? await renderDiagrams(missing.map((d) => d.source)) : [];
  const failed = [];
  let uploaded = 0;
  for (const diagram of diagrams) {
    let attachment = attachments.find((a) => a.filename === diagram.name);
    if (!attachment) {
      const result = drawn[missing.indexOf(diagram)];
      if (result.error) {
        failed.push(result.error);
        continue;
      }
      attachment = await uploadAttachment(creds, site, key, diagram.name, result.png);
      attachments.unshift(attachment);
      uploaded++;
    }
    links[diagram.name] = { url: attachment.content, filename: attachment.filename };
  }
  return { drawn: uploaded, failed };
}

const MARKDOWN = /\.(md|markdown)$/i;

// The local files the text links to, and the files those Markdown files link to in turn (db.md →
// ./V02__create.sql), each read once. Only the first level keeps its href: links in the description
// point at it, the files further down are just attached.
async function linkedFiles(source, text) {
  const files = [];
  const seen = new Set([source.uri.path]);
  const queue = [{ from: source.uri, text, top: true }];
  while (queue.length) {
    const { from, text: md, top } = queue.shift();
    for (const target of localTargets(md)) {
      const uri = attachableUri(source, target.path, from);
      if (!uri) continue;
      const known = files.find((f) => f.uri.path === uri.path);
      if (known) {
        if (top && !known.hrefs.includes(target.href)) known.hrefs.push(target.href);
        continue;
      }
      if (seen.has(uri.path)) continue;
      seen.add(uri.path);
      const bytes = await readLocalFile(uri);
      if (!bytes) continue;
      files.push({ uri, name: target.name, hrefs: top ? [target.href] : [], bytes });
      if (MARKDOWN.test(target.name)) queue.push({ from: uri, text: bytes.toString('utf8'), top: false });
    }
  }
  return files;
}

// Files the description links to (./config.ts) go to Jira as attachments of the issue, so the
// links still lead somewhere there; so do those in `extra` (the Attachments section, the comments)
// and those the linked Markdown files link to. An attachment with the same name and content is
// reused. A changed file replaces the attachments of its name: the new version is uploaded and the
// older ones are deleted, so the issue keeps one copy of each file. With options.files off nothing
// is uploaded but the drawn diagrams; content comes back with them as images.
async function attachLinkedFiles(creds, site, key, source, content, options) {
  const files = options.files ? await linkedFiles(source, content + '\n\n' + (options.extra || '')) : [];
  const diagrams = options.diagrams ? diagramsIn(content) : [];
  if (!files.length && !diagrams.length) return { content, links: undefined, uploaded: [], drawn: 0, failed: [] };

  const attachments = (await fetchIssue(creds, site, key, ['attachment'])).fields.attachment || [];
  const links = {};
  const uploaded = [];
  const kept = new Set();
  const replaced = new Set();
  for (const file of files) {
    let attachment = null;
    for (const a of attachments) {
      if (a.filename !== file.name || Number(a.size) !== file.bytes.length) continue;
      if ((await downloadAttachment(creds, a.content)).equals(file.bytes)) {
        attachment = a;
        break;
      }
    }
    if (!attachment) {
      attachment = await uploadAttachment(creds, site, key, file.name, file.bytes);
      attachments.unshift(attachment);
      uploaded.push(file.name);
    }
    kept.add(String(attachment.id));
    replaced.add(file.name);
    for (const href of file.hrefs) links[href] = { url: attachment.content, filename: attachment.filename };
  }
  // Older versions go only once every file has its attachment, so two files of one name both stay.
  for (const a of attachments) {
    if (!replaced.has(a.filename) || kept.has(String(a.id))) continue;
    try {
      await deleteAttachment(creds, site, a.id);
    } catch (e) {
      // Jira lets only some users delete attachments; the old version then stays.
    }
  }
  const { drawn, failed } = await attachDiagrams(creds, site, key, diagrams, attachments, links);
  const named = new Set(diagrams.map((d) => d.name).filter((name) => links[name]));
  return { content: withDiagramImages(content, named), links, uploaded, drawn, failed };
}

function countOf(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

// Comments of the file without an id are added to the issue; changed ones are updated, which Jira
// allows only to their author (or an admin). Comments deleted from the file stay in Jira.
async function publishComments(creds, site, issue, local, links, body) {
  const remote = new Map((await fetchComments(creds, site, issue.key)).map((c) => [String(c.id), c]));
  const list = [];
  const failed = [];
  let added = 0;
  let updated = 0;
  for (const comment of local) {
    const md = shiftHeadings(comment.md, -3);
    if (!comment.md.trim()) {
      list.push(comment);
    } else if (!comment.id) {
      const made = await addComment(creds, site, issue.key, descriptionFor(md, issue.fields.description, links));
      list.push({ id: String(made.id), heading: commentHeading(made), md: comment.md });
      added++;
    } else {
      list.push(comment);
      const current = remote.get(comment.id);
      if (!current || commentMarkdown(issue, current, body) === comment.md.trim()) continue;
      try {
        await updateComment(creds, site, issue.key, comment.id, descriptionFor(md, current.body, links));
        updated++;
      } catch (e) {
        failed.push(comment.heading.replace(/\s*<!--[\s\S]*$/, ''));
      }
    }
  }
  return { list, added, updated, failed };
}

function commentsNote(comments) {
  if (!comments) return '';
  return (comments.added ? ' Added ' + countOf(comments.added, 'comment') + '.' : '') +
    (comments.updated ? ' Updated ' + countOf(comments.updated, 'comment') + '.' : '') +
    (comments.failed.length ? ' Jira refused to change ' + countOf(comments.failed.length, 'comment') +
      ' (only their authors can): ' + comments.failed.join('; ') + '.' : '');
}

function attachedNote({ uploaded, drawn, failed }) {
  return (uploaded.length ? ' Attached ' + uploaded.join(', ') + '.' : '') +
    (drawn ? ' Drew ' + drawn + (drawn === 1 ? ' diagram.' : ' diagrams.') : '') +
    (failed.length ? ' ' + (failed.length === 1 ? 'A diagram' : failed.length + ' diagrams') +
      ' could not be drawn and went as code: ' + failed.join('; ') + '.' : '');
}

function editorSource(editor) {
  return {
    uri: editor.document.uri,
    text: editor.document.getText(),
    fileName: baseName(editor.document.fileName),
    editor
  };
}

async function uriSource(uri) {
  return {
    uri,
    text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),
    fileName: baseName(uri.fsPath || uri.path),
    editor: null
  };
}

async function writeBinding(source, meta) {
  const text = source.editor ? source.editor.document.getText() : source.text;
  const { rawLength, extraLines } = parseFrontMatter(text);
  const fm = serializeFrontMatter(meta, extraLines) + (rawLength ? '' : '\n');
  if (!source.editor) {
    await vscode.workspace.fs.writeFile(source.uri, Buffer.from(fm + text.slice(rawLength), 'utf8'));
    return;
  }
  const document = source.editor.document;
  await source.editor.edit((edit) => {
    edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(rawLength)), fm);
  });
}

function dirOf(path) {
  return path.split('/').slice(0, -1).join('/');
}

function packageName(issue) {
  return issueFileName(issue.key, issue.summary).replace(/\.md$/, '');
}

// Where Download would put the issue: the file already bound to it, else the folder of its saved
// epic, else a package of its own (or of the epic it was just created in).
function packagePath(issue, epic, saved) {
  const known = new Map(saved.filter((s) => s.key).map((s) => [s.key, s.relPath]));
  if (known.has(issue.key)) return known.get(issue.key);
  const epicPath = issue.epic && known.get(issue.epic);
  const dir = (epicPath && dirOf(epicPath)) || packageName(epic || issue);
  return dir + '/' + issueFileName(issue.key, issue.summary);
}

// A file published from outside the download folder is also saved there, in the issue's package,
// like a download: the issue's file there is refreshed, or a new one made.
async function saveToPackage(source, issue, epic, content) {
  const root = packageRootUri(source.uri);
  if (!root || source.uri.path.startsWith(root.path.replace(/\/+$/, '') + '/')) return null;
  const saved = await readSavedIssues(root);
  const relPath = packagePath(issue, epic, saved);
  const segments = relPath.split('/');
  const uri = vscode.Uri.joinPath(root, ...segments);
  const previous = saved.find((s) => s.relPath === relPath);
  const sameIssue = !!previous && previous.key === issue.key;
  if (!await confirmOverwrite([{ uri, relPath, sameIssue }])) return null;
  const toDir = vscode.Uri.joinPath(root, ...segments.slice(0, -1));
  const markdown = rebaseLinks(content, vscode.Uri.joinPath(source.uri, '..').path, toDir.path);
  await vscode.workspace.fs.createDirectory(toDir);
  await vscode.workspace.fs.writeFile(uri,
    Buffer.from(publishedDocument(issue, markdown, sameIssue ? previous.text : ''), 'utf8'));
  return uri;
}

// The file without its front matter, with the comments' new ids, when comments were added.
async function writeBody(source, body) {
  const text = source.editor ? source.editor.document.getText() : source.text;
  const { rawLength } = parseFrontMatter(text);
  if (!source.editor) {
    source.text = text.slice(0, rawLength) + body;
    await vscode.workspace.fs.writeFile(source.uri, Buffer.from(source.text, 'utf8'));
    return;
  }
  const document = source.editor.document;
  await source.editor.edit((edit) => {
    edit.replace(new vscode.Range(document.positionAt(rawLength), document.positionAt(text.length)), body);
  });
}

// The file's own parts: the # heading, the description, and the Comments and Attachments sections.
function fileDocument(source) {
  const { meta, body } = parseFrontMatter(source.text);
  const sections = splitSections(body);
  const { title, content } = splitTitleAndBody(sections.main, source.fileName.replace(/\.md$/i, '') || 'Untitled');
  return { meta, body, title, content, main: sections.main, comments: sections.comments, attachments: sections.attachments };
}

function sectionsText(doc) {
  return [doc.attachments || ''].concat((doc.comments || []).map((c) => c.md)).join('\n\n');
}

// Publishing comments gives the new ones ids, which the file has to keep.
async function afterComments(source, doc, comments) {
  if (!comments || !comments.added) return doc.comments;
  await writeBody(source, joinSections(doc.main, comments.list, doc.attachments));
  return comments.list;
}

function partsNote(parts) {
  const sent = ['summary', 'description', 'comments', 'attachments'].filter((p) => parts[p]);
  return sent.length === 4 ? '' : ' Sent: ' + (sent.join(', ') || 'nothing') + ' (jiraToMd.sync).';
}

function savedNote(uri) {
  return uri ? ' Saved to ' + vscode.workspace.asRelativePath(uri, false) + '.' : '';
}

// What Publish sends to an existing issue (jiraToMd.sync); a binding made by 1.5.0 with the issue's
// summary kept never sends the summary.
function partsFor(source, meta) {
  const parts = syncParts(source.uri);
  if (meta.keepSummary) parts.summary = false;
  return parts;
}

// Without the summary the # heading is not the summary, so it stays in the description.
async function publishUpdate(source, meta, doc) {
  const parts = partsFor(source, meta);
  if (!Object.values(parts).some(Boolean)) {
    vscode.window.showWarningMessage('Nothing to publish: every part of jiraToMd.sync is off.');
    return;
  }
  const content = parts.summary ? doc.content : doc.main.replace(/^\s+/, '');
  const parsed = parseJiraUrl(meta.url);
  if (!parsed || !parsed.issueKey) throw new Error('bad-url');
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { issue: current } = await withNotification('Checking ' + parsed.issueKey + ' in Jira…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (meta.updated && current.updated !== meta.updated) {
    const overwrite = 'Overwrite';
    const picked = await vscode.window.showWarningMessage(
      current.key + ' has changed in Jira (' + current.updated + ', your local copy is from ' + meta.updated + '). Overwrite?',
      { modal: true }, overwrite);
    if (picked !== overwrite) return;
  }

  const summary = parts.summary ? doc.title : current.summary;
  const { updated, attached, comments } = await withNotification('Publishing ' + current.key + ' to Jira…', async () => {
    const files = await attachLinkedFiles(creds, parsed.site, current.key, source, parts.description ? content : '',
      { files: parts.attachments, diagrams: parts.description, extra: sectionsText(doc) });
    const fields = {};
    if (parts.summary) fields.summary = summary;
    if (parts.description) fields.description = descriptionFor(files.content, current.fields.description, files.links);
    if (Object.keys(fields).length) await updateIssue(creds, parsed.site, current.key, { fields });
    const posted = parts.comments && doc.comments
      ? await publishComments(creds, parsed.site, current, doc.comments, files.links, doc.body) : null;
    return { updated: await fetchIssue(creds, parsed.site, current.key, ['updated']), attached: files, comments: posted };
  });

  const commentList = await afterComments(source, doc, comments);
  await writeBinding(source, Object.assign({}, meta, { updated: updated.fields.updated }));
  // The copy mirrors the issue, so with the description not sent there is nothing to copy.
  const copy = !parts.description ? null : await saveToPackage(source,
    Object.assign({}, current, { summary, updated: updated.fields.updated }), null,
    joinSections(content, commentList, doc.attachments));
  vscode.window.showInformationMessage('Published ' + current.key + ' "' + summary + '".' +
    attachedNote(attached) + commentsNote(comments) + partsNote(parts) + savedNote(copy));
  return { url: meta.url, key: current.key, action: 'updated' };
}

async function askForTarget() {
  const targetUrl = await vscode.window.showInputBox({
    prompt: 'Paste a link to the Jira issue whose description this file replaces — ' +
      'or to an epic or a project to create a new issue in',
    placeHolder: 'https://…/browse/PROJ-12',
    ignoreFocusOut: true
  });
  if (!targetUrl) return null;
  const parsed = parseJiraUrl(targetUrl);
  if (!parsed) throw new Error('bad-target');
  return parsed;
}

async function pickEpicAction(epic, title) {
  const create = { label: 'Create a new issue in epic ' + epic.key, description: '"' + title + '"' };
  const replace = { label: 'Replace the description of epic ' + epic.key, description: '"' + epic.summary + '"' };
  const picked = await vscode.window.showQuickPick([create, replace],
    { placeHolder: epic.key + ' is an epic — what should "' + title + '" do?', ignoreFocusOut: true });
  return picked ? (picked === create ? 'create' : 'replace') : null;
}

// Binds the file to an issue that already exists, e.g. one created with an empty description.
// jiraToMd.sync says what is replaced, so this is asked only once, for the binding.
function replacedPart(parts, target, title) {
  const out = [];
  if (parts.summary && title !== target.summary) out.push('Its summary becomes "' + title + '".');
  if (parts.description) out.push(target.description.trim() ? 'Its current description is replaced.' : 'Its description is empty.');
  if (parts.comments) out.push('New comments from the file are added.');
  if (parts.attachments) out.push('Files the file links to are attached.');
  const kept = [];
  if (!parts.summary) kept.push('summary');
  if (!parts.description) kept.push('description');
  if (kept.length) out.push('Its ' + kept.join(' and ') + ' stay' + (kept.length === 1 ? 's' : '') + '.');
  return out.join(' ');
}

async function replaceExisting(source, target, doc) {
  const parts = syncParts(source.uri);
  const picked = await vscode.window.showWarningMessage(
    'Publish this file to ' + target.key + ' "' + target.summary + '"? ' + replacedPart(parts, target, doc.title) +
    ' The file is bound to the issue, so later publishes update it. ' +
    'What is published is set by jiraToMd.sync.',
    { modal: true }, PUBLISH);
  if (picked !== PUBLISH) return;
  const meta = { url: issueWebUrl(target.site, target.key), updated: target.updated };
  return publishUpdate(source, meta, doc);
}

async function publishNew(source, doc) {
  const { title, content } = doc;
  const parsed = await askForTarget();
  if (!parsed) return;
  const creds = await credentialsFor(parsed.site);
  if (!creds) return;

  const { ctx, issue: target } = await withNotification('Checking the issue in Jira…',
    () => contextAndIssue(creds, parsed.site, parsed.issueKey));
  if (target && !target.isEpic) return replaceExisting(source, target, doc);
  if (target) {
    const action = await pickEpicAction(target, title);
    if (!action) return;
    if (action === 'replace') return replaceExisting(source, target, doc);
  }
  const epic = target;

  const type = await vscode.window.showQuickPick(ISSUE_TYPES,
    { placeHolder: 'Issue type for "' + title + '"', ignoreFocusOut: true });
  if (!type) return;

  const description = descriptionFor(content, epic && epic.fields.description);
  const fields = {
    project: { key: epic ? epic.project : parsed.projectKey },
    issuetype: { name: type },
    summary: title,
    description
  };
  if (epic && ctx.epicLinkId) fields[ctx.epicLinkId] = epic.key;
  else if (epic && isCloud(parsed.site)) fields.parent = { key: epic.key };

  // A new issue always gets its summary and description; files and comments follow jiraToMd.sync.
  const parts = syncParts(source.uri);
  const created = await withNotification('Creating the issue in Jira…', async () => {
    const made = await createIssue(creds, parsed.site, fields);
    // Attachments need the issue, so links to local files are fixed once it exists.
    const files = await attachLinkedFiles(creds, parsed.site, made.key, source, content,
      { files: parts.attachments, diagrams: true, extra: sectionsText(doc) });
    if (files.links) {
      const linked = descriptionFor(files.content, epic && epic.fields.description, files.links);
      await updateIssue(creds, parsed.site, made.key, { fields: { description: linked } });
    }
    const issue = { key: made.key, fields: { description } };
    const posted = parts.comments && doc.comments
      ? await publishComments(creds, parsed.site, issue, doc.comments, files.links, doc.body) : null;
    const fresh = await fetchIssue(creds, parsed.site, made.key, ['updated']);
    return { key: made.key, updated: fresh.fields.updated, attached: files, comments: posted };
  });

  const url = issueWebUrl(parsed.site, created.key);
  const commentList = await afterComments(source, doc, created.comments);
  await writeBinding(source, { url, updated: created.updated });
  const copy = await saveToPackage(source, {
    key: created.key, summary: title, type, updated: created.updated, epic: epic ? epic.key : '', site: parsed.site
  }, epic, joinSections(content, commentList, doc.attachments));
  vscode.window.showInformationMessage('Created ' + created.key + ' "' + title + '"' +
    (epic ? ' in epic ' + epic.key : '') + '.' + attachedNote(created.attached) + commentsNote(created.comments) +
    savedNote(copy));
  return { url, key: created.key, action: 'created' };
}

async function publishIssueCommand(fileUri) {
  const editor = fileUri ? null : vscode.window.activeTextEditor;
  if (!fileUri && !editor) {
    vscode.window.showErrorMessage('Open the Markdown file you want to publish to Jira.');
    return;
  }

  try {
    const source = fileUri ? await uriSource(fileUri) : editorSource(editor);
    const doc = fileDocument(source);
    return doc.meta ? await publishUpdate(source, doc.meta, doc) : await publishNew(source, doc);
  } catch (e) {
    if (fileUri) throw new Error(errorMessage(e));
    vscode.window.showErrorMessage(errorMessage(e));
  }
}

module.exports = { publishIssueCommand };
