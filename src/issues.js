const { fetchFields, fetchIssue, searchIssues, isCloud } = require('./jiraClient');

const BASE_FIELDS = ['summary', 'description', 'issuetype', 'status', 'parent', 'updated', 'project', 'attachment'];

async function jiraContext(creds, site) {
  const list = isCloud(site) ? [] : await fetchFields(creds, site);
  const epicLink = list.find((f) => f.schema && f.schema.custom === 'com.pyxis.greenhopper.jira:gh-epic-link') ||
    list.find((f) => String(f.name).toLowerCase() === 'epic link') || null;
  return { creds, site, epicLinkId: epicLink ? epicLink.id : '' };
}

function fieldsFor(ctx) {
  return BASE_FIELDS.concat(ctx.epicLinkId ? [ctx.epicLinkId] : []);
}

function isEpic(j) {
  const type = (j.fields && j.fields.issuetype) || {};
  return String(type.name || '').toLowerCase() === 'epic' || type.hierarchyLevel === 1;
}

function epicOf(ctx, j) {
  const f = j.fields || {};
  if (ctx.epicLinkId && f[ctx.epicLinkId]) return String(f[ctx.epicLinkId]);
  const parent = f.parent;
  const parentType = parent && parent.fields && parent.fields.issuetype;
  return parent && parentType && isEpic(parent) ? parent.key : '';
}

function issueOf(ctx, j) {
  const f = j.fields || {};
  return {
    key: j.key,
    summary: f.summary || '',
    description: String(f.description || ''),
    type: (f.issuetype && f.issuetype.name) || '',
    status: (f.status && f.status.name) || '',
    updated: f.updated || '',
    project: (f.project && f.project.key) || String(j.key).split('-')[0],
    epic: epicOf(ctx, j),
    attachments: f.attachment || [],
    isEpic: isEpic(j),
    fields: f,
    site: ctx.site
  };
}

async function loadIssue(ctx, key) {
  return issueOf(ctx, await fetchIssue(ctx.creds, ctx.site, key, fieldsFor(ctx)));
}

async function loadEpicChildren(ctx, epicKey) {
  const jql = (ctx.epicLinkId ? '"Epic Link" = ' : 'parent = ') + epicKey + ' ORDER BY key ASC';
  const found = await searchIssues(ctx.creds, ctx.site, jql, fieldsFor(ctx));
  return found.map((j) => ({ ...issueOf(ctx, j), epic: epicKey }));
}

async function contextAndIssue(creds, site, key) {
  const ctx = await jiraContext(creds, site);
  return { ctx, issue: key ? await loadIssue(ctx, key) : null };
}

module.exports = { contextAndIssue, loadEpicChildren };
