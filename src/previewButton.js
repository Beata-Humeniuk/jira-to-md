const { parseFrontMatter } = require('./frontMatter');

const TOKEN = 'jira_to_md_actions';

function actionLink(uriScheme, extensionId, action, fileUri) {
  return uriScheme + '://' + extensionId + '/' + action + '?file=' + encodeURIComponent(String(fileUri));
}

function fileUriCandidates(query) {
  const m = /(?:^|&)file=(.*)$/.exec(String(query || ''));
  if (!m || !m[1]) return [];
  const out = [m[1]];
  try {
    const decoded = decodeURIComponent(m[1]);
    if (decoded !== m[1]) out.push(decoded);
  } catch (e) { }
  return out;
}

function previewButtons(md, options) {
  md.core.ruler.push(TOKEN, (state) => {
    const { meta } = parseFrontMatter(state.src);
    if (!meta) return;
    const token = new state.Token(TOKEN, '', 0);
    token.block = true;
    token.meta = { url: meta.url };
    state.tokens.unshift(token);
  });

  md.renderer.rules[TOKEN] = (tokens, idx, opts, env) => {
    const doc = env && env.currentDocument;
    if (!doc || doc.scheme === 'untitled') return '';
    const key = tokens[idx].meta.url.split('/').pop();
    const button = (action, label, title) => '<a class="jira-to-md-' + action + '" href="' +
      md.utils.escapeHtml(actionLink(options.uriScheme, options.extensionId, action, doc)) +
      '" title="' + md.utils.escapeHtml(title) + '">' + label + '</a>';
    return '<div class="jira-to-md-actions">' +
      button('pull', '&#x21bb; Pull', 'Update this file from Jira issue ' + key) +
      button('push', '&#x2191; Push', 'Push this file to Jira issue ' + key) +
      '</div>\n';
  };

  return md;
}

module.exports = { previewButtons, actionLink, fileUriCandidates };
