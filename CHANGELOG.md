# Changelog

This file lists user-visible changes to Jira to Markdown. The project follows
[Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-27

### Added

- Files the description links to, e.g.
  `[Configuration](./config/conditions.ts)`, are pushed as attachments of the
  issue and the link points to the attachment, so it no longer leads to a
  "cannot open the issue" page in Jira. A file whose name and content match an
  existing attachment is not uploaded again. Only files inside the workspace
  folder are sent, never hidden ones such as `.env`.
- Pull and repeated downloads point such links back to the local files.
## [1.3.1] - 2026-10-27

### Fixed

- Merged table cells: a cell holding only `^^` (MultiMarkdown tables, as in
  Markdown preview extensions) is pushed as a cell spanning rows instead of the
  text `^^`. Downloaded cells spanning rows become `^^`, so the following cells
  no longer shift left, and a table with cells spanning columns stays HTML.
  Wiki markup cannot merge cells, so there the `^^` cell is left empty.

## [1.3.0] - 2026-10-27

### Changed

- GitHub-style alerts (`> [!WARNING] UWAGA`) are pushed as panels: a coloured
  quote with a bold title in HTML, `{warning:title=UWAGA}` in wiki markup.
  Before, Jira showed `[!WARNING]` as text, run together with the next line.
  Downloaded panels become alerts again.
- Raw HTML in the Markdown (e.g. a list inside a table cell) is pushed as HTML
  instead of escaped text, so Jira no longer shows the tags.
- A downloaded table cell holding a list or several paragraphs stays HTML
  instead of being flattened into one run of text.

## [1.2.1] - 2026-10-26

### Fixed

- `jiraToMd.downloadFolder` and `jiraToMd.askSubfolder` set in a folder's
  settings (`.vscode/settings.json`) are honoured. Before, they were ignored and
  issues were saved next to the file open in the editor.

## [1.2.0] - 2026-10-26

### Changed

- Each download is saved as a package: a folder named like the issue, e.g.
  `PROJ-1_Login_rework/`, holding the issue's file or, for an epic, the epic's
  file and all its stories and tasks. Files already downloaded stay where they
  are and are refreshed in place; new issues of an epic join the folder the
  epic is already saved in.

## [1.1.1] - 2026-10-21

### Fixed

- Tables pushed as HTML have borders, padding and left-aligned cells, so they
  are readable in Jira's rich-text editor.

## [1.1.0] - 2026-10-21

### Changed

- Downloaded issues are named `<KEY>_<Summary_with_underscores>.md`, for
  example `PROJ-2_Add_two-factor_login.md`: the key in upper case, then the
  summary as written, with spaces as underscores. Files saved under the old
  names are still found and refreshed by their issue key.

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
