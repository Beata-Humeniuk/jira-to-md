const MarkdownIt = require('markdown-it');

function mdToHtml(md) {
  const mdit = new MarkdownIt({ html: false, linkify: true });
  return mdit.render(String(md == null ? '' : md)).replace(/\n+$/, '');
}

module.exports = { mdToHtml };
