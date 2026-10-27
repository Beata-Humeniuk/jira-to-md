const MarkdownIt = require('markdown-it');
const { alerts } = require('./alerts');
const { attachmentLinks } = require('./attachments');

const CELL_STYLE = 'border:1px solid #c1c7d0;padding:4px 8px;text-align:left;vertical-align:top';

const ALERT_COLORS = {
  NOTE: ['#0052cc', '#deebff'],
  TIP: ['#00875a', '#e3fcef'],
  IMPORTANT: ['#5243aa', '#eae6ff'],
  WARNING: ['#ff991f', '#fffae6'],
  CAUTION: ['#de350b', '#ffebe6']
};

// Bare <table> markup shows no borders in Jira's rich-text editor, so tables carry Jira's own classes and inline borders.
function borderedTables(md) {
  const style = (name, cls, extra) => {
    md.renderer.rules[name] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      token.attrJoin('class', cls);
      const own = token.attrGet('style');
      token.attrSet('style', extra + (own ? ';' + own : ''));
      if (name === 'table_open') token.attrSet('border', '1');
      return self.renderToken(tokens, idx, options);
    };
  };
  style('table_open', 'confluenceTable', 'border-collapse:collapse');
  style('th_open', 'confluenceTh', CELL_STYLE + ';font-weight:bold;background:#f4f5f7');
  style('td_open', 'confluenceTd', CELL_STYLE);
  return md;
}

// A cell holding only ^^ (MultiMarkdown tables) merges into the cell above it as a rowspan.
function mergedCells(md) {
  md.core.ruler.push('jira_to_md_rowspan', (state) => {
    const tokens = state.tokens;
    const drop = new Set();
    let above = [];
    let col = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'thead_open' || t.type === 'tbody_open') above = [];
      if (t.type === 'tr_open') col = 0;
      if (t.type !== 'td_open' && t.type !== 'th_open') continue;
      const origin = above[col];
      if (tokens[i + 1].content.trim() === '^^' && origin) {
        origin.attrSet('rowspan', String(Number(origin.attrGet('rowspan') || 1) + 1));
        drop.add(i).add(i + 1).add(i + 2);
      } else {
        above[col] = t;
      }
      col++;
    }
    if (drop.size) state.tokens = tokens.filter((t, i) => !drop.has(i));
  });
  return md;
}

// Alerts become a coloured quote with a bold title; the class lets htmlToMd read them back.
function alertQuotes(md) {
  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const alert = tokens[idx].meta && tokens[idx].meta.alert;
    if (!alert) return self.renderToken(tokens, idx, options);
    const [border, background] = ALERT_COLORS[alert.kind];
    return '<blockquote class="jira-to-md-alert-' + alert.kind.toLowerCase() + '" style="border-left:4px solid ' + border +
      ';background:' + background + ';padding:4px 12px;margin-left:0">\n<p><strong>' + md.utils.escapeHtml(alert.title) + '</strong></p>\n';
  };
  return md;
}

// Raw HTML is kept: the preview shows it as HTML, so Jira should too, not as escaped tags.
// links maps local file links to the Jira attachments they were uploaded as.
function mdToHtml(md, links) {
  const mdit = attachmentLinks(mergedCells(alertQuotes(borderedTables(alerts(new MarkdownIt({ html: true, linkify: true }))))),
    (attachment) => attachment.url);
  return mdit.render(String(md == null ? '' : md), { links }).replace(/\n+$/, '');
}

module.exports = { mdToHtml };
