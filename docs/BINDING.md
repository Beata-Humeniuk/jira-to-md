# Binding and conversion

## Issue binding

A `jira:` front matter block binds a Markdown file to a Jira issue. Downloaded
files receive one automatically:

```yaml
---
jira:
  url: https://example.atlassian.net/browse/PROJ-2
  updated: 2026-09-25T10:11:12.000+0000
key: PROJ-2
issueType: Story
status: In Progress
epic: PROJ-1
generator: jira-to-md@1.0.0
generated: 2026-09-25
managed: true
---

# Add two-factor login

## Why
...
```

- `url` names the issue. `updated` is the issue's last-change time in Jira when
  the file was downloaded or pushed; Push and Pull compare it with Jira to
  notice changes made there meanwhile.
- `key`, `issueType`, `status`, and `epic` describe the issue at the last
  download. They are refreshed by Pull and not sent to Jira.
- Keys you add yourself are kept by Pull.

The first `#` heading is the issue summary. If there is none, the file name is
used.

## Markdown ↔ Jira markup

Descriptions go through REST API v2, which Cloud and Server/Data Center both
support. Download reads both Jira wiki markup and HTML. Push writes HTML by
default; with `jiraToMd.descriptionFormat` set to `wiki` it writes wiki markup,
and these constructs survive a round trip unchanged:

| Markdown | Jira |
|---|---|
| `## Heading` | `h2. Heading` |
| `**bold**`, `_italic_`, `~~struck~~` | `*bold*`, `_italic_`, `-struck-` |
| `` `code` `` | `{{code}}` |
| `[text](https://…)`, bare links | `[text\|https://…]`, bare links |
| `- item`, nested lists, `1. item` | `* item`, `** item`, `# item` |
| `- [ ] 1.1 Task` | `* [ ] 1.1 Task` (the checkbox is text in Jira) |
| `> quote` | `{quote}…{quote}` |
| `> [!WARNING] Title` alerts (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) | `{info}`, `{tip}`, `{note}`, `{warning}` panels, `{warning:title=Title}` (`CAUTION` comes back as `WARNING`) |
| ```` ```lang ```` fences | `{code:lang}` (without a language: `{noformat}`) |
| Tables | `\|\|head\|\|` and `\|cell\|` rows |
| `---` | `----` |

In HTML, alerts become a coloured quote with the title in bold and read back as
alerts. Raw HTML in the Markdown goes to Jira as HTML, and a downloaded table
cell holding a list or several paragraphs stays HTML, as a Markdown cell holds
a single line.

A cell holding only `^^` merges into the cell above it, as in MultiMarkdown
tables; downloaded cells spanning rows come back that way. Markdown has no
column spans, so a downloaded table with them stays HTML. Wiki markup cannot
merge cells: there a `^^` cell is sent empty.

Jira constructs without a Markdown counterpart — mentions (`[~accountid:…]`),
attached images (`!file.png!`), colours, `{panel}` — stay in the file as written
and go back to Jira unchanged. Panels and colour macros lose their frame.

Edits made in Jira's rich editor on Cloud are stored as Atlassian Document
Format; Jira converts them to wiki markup for the API, so unusual formatting may
come back simplified.

## Linked files

A link or image pointing at a file next to the Markdown file, e.g.
`[Configuration](./config/conditions.ts)`, is uploaded on Push as an attachment of
the issue, and the description links to the attachment (`[text|^conditions.ts]`
in wiki markup). An attachment with the same name and content is reused instead
of uploaded again; a changed file is uploaded as a new attachment and the older
one stays in Jira. Only files inside the workspace folder are sent, and no
hidden files or folders (`.env`, `.ssh/…`). Links to files that do not exist go
out unchanged.

Pull, and downloading an issue again into the same file, turn links to those
attachments back into the local links. A first download keeps the links to the
attachments in Jira.
