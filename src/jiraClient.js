const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const PROJECT = /^[A-Z][A-Z0-9_]*$/i;

function hostOf(origin) {
  return String(origin).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function siteOf(origin, basePath) {
  return {
    origin,
    basePath: String(basePath || '').replace(/\/+$/, ''),
    cloud: /\.atlassian\.net$/i.test(hostOf(origin))
  };
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (e) {
    return pathname;
  }
}

function parseJiraUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch (e) {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const path = decodePath(u.pathname);

  const selected = u.searchParams.get('selectedIssue');
  const browse = path.match(/^(.*?)\/browse\/([^/?#]+)/);
  const projects = path.match(/^(.*?)(?:\/jira\/[a-z]+(?:\/c)?)?\/projects\/([^/?#]+)(?:\/issues\/([^/?#]+))?/i);
  const base = (browse && browse[1]) || (projects && projects[1]) || '';

  if (selected && KEY.test(selected)) return { site: siteOf(u.origin, base), issueKey: selected.toUpperCase() };
  if (browse && KEY.test(browse[2])) return { site: siteOf(u.origin, base), issueKey: browse[2].toUpperCase() };
  if (projects && projects[3] && KEY.test(projects[3])) {
    return { site: siteOf(u.origin, base), issueKey: projects[3].toUpperCase() };
  }
  if (browse && PROJECT.test(browse[2])) return { site: siteOf(u.origin, base), projectKey: browse[2].toUpperCase() };
  if (projects && PROJECT.test(projects[2])) return { site: siteOf(u.origin, base), projectKey: projects[2].toUpperCase() };
  return null;
}

function isCloud(site) {
  return !!(site && site.cloud);
}

function authFor(site, token, email) {
  return { token, email: isCloud(site) ? String(email || '').trim() : '' };
}

function authHeader(cfg) {
  if (cfg.email) {
    return 'Basic ' + Buffer.from(cfg.email + ':' + cfg.token).toString('base64');
  }
  return 'Bearer ' + cfg.token;
}

function apiRoot(site) {
  return site.origin + site.basePath + '/rest/api/2';
}

function issueWebUrl(site, key) {
  return site.origin + site.basePath + '/browse/' + key;
}

async function rejection(res) {
  let j = null;
  try {
    j = await res.json();
  } catch (e) { }
  const parts = [].concat((j && j.errorMessages) || [],
    Object.entries((j && j.errors) || {}).map(([field, text]) => field + ': ' + text));
  return new Error(parts.length ? 'Jira: ' + parts.join('; ') : 'http-' + res.status);
}

async function request(cfg, url, opts) {
  opts = opts || {};
  const headers = { Authorization: authHeader(cfg), Accept: 'application/json' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401 || res.status === 403) throw new Error('auth');
  if (res.status === 404) throw new Error('not-found');
  if (res.status === 400) throw await rejection(res);
  if (!res.ok) throw new Error('http-' + res.status);
  return res.status === 204 ? {} : res.json();
}

function apiGet(cfg, site, path) {
  return request(cfg, apiRoot(site) + path);
}

function apiSend(cfg, site, method, path, body) {
  return request(cfg, apiRoot(site) + path, { method, body });
}

async function fetchFields(cfg, site) {
  return apiGet(cfg, site, '/field');
}

async function fetchIssue(cfg, site, key, fields) {
  return apiGet(cfg, site, '/issue/' + encodeURIComponent(key) +
    '?fields=' + encodeURIComponent(fields.join(',')));
}

async function searchIssues(cfg, site, jql, fields) {
  const out = [];
  const query = '?jql=' + encodeURIComponent(jql) + '&fields=' + encodeURIComponent(fields.join(',')) +
    '&maxResults=100';
  if (isCloud(site)) {
    let token = '';
    for (;;) {
      const j = await apiGet(cfg, site, '/search/jql' + query +
        (token ? '&nextPageToken=' + encodeURIComponent(token) : ''));
      out.push(...(j.issues || []));
      token = j.nextPageToken;
      if (!token || j.isLast || !(j.issues || []).length) return out;
    }
  }
  for (;;) {
    const j = await apiGet(cfg, site, '/search' + query + '&startAt=' + out.length);
    out.push(...(j.issues || []));
    if (!(j.issues || []).length || out.length >= (j.total || 0)) return out;
  }
}

async function createIssue(cfg, site, fields) {
  return apiSend(cfg, site, 'POST', '/issue', { fields });
}

async function updateIssue(cfg, site, key, body) {
  return apiSend(cfg, site, 'PUT', '/issue/' + encodeURIComponent(key), body);
}

module.exports = {
  parseJiraUrl, hostOf, isCloud, authFor, authHeader, apiRoot, issueWebUrl,
  fetchFields, fetchIssue, searchIssues, createIssue, updateIssue
};
