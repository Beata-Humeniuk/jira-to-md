const MarkdownIt = require('markdown-it');

const CELL_STYLE = 'border:1px solid #c1c7d0;padding:4px 8px;text-align:left;vertical-align:top';

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

function mdToHtml(md) {
  const mdit = borderedTables(new MarkdownIt({ html: false, linkify: true }));
  return mdit.render(String(md == null ? '' : md)).replace(/\n+$/, '');
}

module.exports = { mdToHtml };
