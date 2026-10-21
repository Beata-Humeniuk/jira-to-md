function errorMessage(e) {
  if (e && e.message === 'auth') return 'Jira rejected the credentials (401/403) — check jiraToMd.token in the settings. Cloud: also set jiraToMd.email (the API token is sent as Basic auth). Server/DC: the PAT is sent as Bearer; the e-mail is not used.';
  if (e && e.message === 'not-found') return 'Issue not found (404) — check the link and your permissions.';
  if (e && e.message === 'bad-url') return 'This link does not point at a Jira issue — paste the full issue address, e.g. https://…/browse/PROJ-123.';
  if (e && e.message === 'bad-parent') return 'Paste a link to an epic or a project, e.g. https://…/browse/PROJ-1 or https://…/browse/PROJ.';
  if (e && /^Jira: /.test(e.message)) return e.message;
  return 'Error: ' + ((e && e.message) || String(e));
}

module.exports = { errorMessage };
