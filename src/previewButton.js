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
    const token = new state.Token(TOKEN, '', 0);
    token.block = true;
    token.meta = { url: meta ? meta.url : '' };
    state.tokens.unshift(token);
  });

  md.renderer.rules[TOKEN] = (tokens, idx, opts, env) => {
    const doc = env && env.currentDocument;
    if (!doc || doc.scheme === 'untitled') return '';
    const { url } = tokens[idx].meta;
    const key = url.split('/').pop();
    const button = (action, label, title) => '<a class="jira-to-md-' + action + '" href="' +
      md.utils.escapeHtml(actionLink(options.uriScheme, options.extensionId, action, doc)) +
      '" title="' + md.utils.escapeHtml(title) + '">' + label + '</a>';
    const buttons = url
      ? button('pull', '&#x21bb; Pull from Jira', 'Update this file from Jira issue ' + key) +
        button('publish', '&#x2191; Publish to Jira', 'Publish this file to Jira issue ' + key)
      : button('publish', '&#x2191; Publish to Jira',
        'Publish this file to Jira: as the description of an existing issue, or as a new issue');
    return '<div class="jira-to-md-actions">' + buttons + '</div>\n';
  };

  return md;
}

module.exports = { previewButtons, actionLink, fileUriCandidates };
