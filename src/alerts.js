// GitHub-style alerts: "> [!WARNING] Optional title" as the first line of a quote.
const KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)/i;

// Jira's info/tip/note/warning panels; CAUTION has no panel of its own.
const WIKI_PANEL = { NOTE: 'info', TIP: 'tip', IMPORTANT: 'note', WARNING: 'warning', CAUTION: 'warning' };
const FROM_WIKI_PANEL = { info: 'NOTE', tip: 'TIP', note: 'IMPORTANT', warning: 'WARNING' };

function defaultTitle(kind) {
  return kind[0] + kind.slice(1).toLowerCase();
}

// Marks a quote that opens with an alert marker (token.meta.alert = { kind, title }) and
// removes the marker line, so renderers only decide how the alert looks.
function alerts(md) {
  md.core.ruler.push('jira_to_md_alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open' || tokens[i + 1].type !== 'paragraph_open') continue;
      const content = tokens[i + 2];
      const m = content.content.match(MARKER);
      if (!m) continue;
      const kind = m[1].toUpperCase();
      tokens[i].meta = { alert: { kind, title: m[2].trim() || defaultTitle(kind) } };
      const br = content.children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
      if (br < 0) {
        tokens.splice(i + 1, 3);
      } else {
        content.children = content.children.slice(br + 1);
        content.content = content.content.slice(content.content.indexOf('\n') + 1);
      }
    }
  });
  return md;
}

function alertLine(kind, title) {
  return '[!' + kind + ']' + (title && title !== defaultTitle(kind) ? ' ' + title : '');
}

module.exports = { alerts, alertLine, defaultTitle, KINDS, WIKI_PANEL, FROM_WIKI_PANEL };
