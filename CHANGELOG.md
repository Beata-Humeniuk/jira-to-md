# Changelog

This file lists user-visible changes to Jira to Markdown. The project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-21

First release under the name Jira to Markdown (`jira-to-md`). It continues
Jira to OpenSpec 0.3.0 without the OpenSpec-specific parts.

### Added

- **Jira: Download Issue or Epic** saves issues as `<KEY>-<summary>.md` files.
  An epic offers all its stories and tasks.
- **Jira: Pull Issue** and **Jira: Push Issue**, also as ↻ Pull and ↑ Push
  buttons in the Markdown preview of a bound file.
- Settings `jiraToMd.downloadFolder` (empty = the active file's folder) and
  `jiraToMd.askSubfolder`, as in Confluence to Markdown.
- `jiraToMd.descriptionFormat`: Push writes HTML by default; `wiki` and `auto`
  are available.
- Jira Cloud and Server/Data Center, HTML and wiki-markup descriptions.

### Changes for Jira to OpenSpec users

- Settings moved from `jiraToOpenspec.*` to `jiraToMd.*`; set the token and
  e-mail again.
- Change names, the `openspecFolder`, `changeField` and `changeLabelPrefix`
  settings, and the `OpenSpec change:` line are gone. Push sends only the
  summary and the description.
