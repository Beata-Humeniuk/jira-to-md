# Jira to Markdown

Download Jira issues as Markdown files, edit them in VS Code, and push them
back to Jira. Download a single issue, or a whole epic with all its stories and
tasks. The extension works with Jira Cloud and Server/Data Center.

**No telemetry.** The extension connects only to the Jira host in the link you
provide. No Jira addresses are built into the code.

## Setup

Add your credentials in the extension settings:

- **Cloud:** set `jiraToMd.token` to an
  [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens)
  and `jiraToMd.email` to your Atlassian account e-mail. The same API token
  works for Confluence to Markdown.
- **Server/Data Center:** set `jiraToMd.token` to a Personal Access Token from
  your Jira profile.

You do not need to configure an instance address. The extension reads the host
and context path from each link, so you can work with multiple instances.

## Download an issue or an epic

1. Run **Jira: Download Issue or Epic**.
2. If `jiraToMd.askSubfolder` is on, type an optional subfolder of the download
   folder, such as `services/account`, or leave it empty.
3. Paste the issue link. `/browse/PROJ-123`, board links with `selectedIssue`,
   `/projects/PROJ/issues/PROJ-123`, context paths, and non-standard ports are
   supported.
4. For an epic, choose which issues to download. The epic and all its stories
   and tasks are preselected.

Each download is saved as a package: a folder named after the issue you
pasted, with every issue as `<KEY>_<Summary_with_underscores>.md` inside it:

```text
docs/jira/
  PROJ-1_Login_rework/
    PROJ-1_Login_rework.md
    PROJ-2_Add_two-factor_login.md
    PROJ-3_Store_TOTP_secrets.md
  PROJ-7_Fix_typo/
    PROJ-7_Fix_typo.md
```

- The download folder is `jiraToMd.downloadFolder`. When it is empty, issues are
  saved next to the file open in the editor (or in the workspace root).
- The issue summary becomes the `#` heading and the description the body,
  converted from Jira markup or HTML to Markdown.
- Downloading an issue again refreshes the file it was saved to, even if you
  renamed or moved the file within the download folder.
  New issues of an epic join the folder the epic is already saved in.
- A file with the same name that is not bound to the issue is replaced only
  after you confirm.

## Update a file from Jira

Open the Markdown preview: a file bound to an issue shows a small **↻ Pull**
button in its top right corner. You can also run **Jira: Pull Issue**.

The extension compares the issue's last-updated time first. If nothing changed,
nothing happens. Otherwise it asks before replacing the file content, because
edits you have not pushed are lost. Your own front matter keys are kept.

## Push to Jira

Open the Markdown file and run **Jira: Push Issue**, or click **↑ Push** in the
Markdown preview of a bound file; it asks first and saves unsaved edits.

- **A bound file** (with a `jira:` block) updates its issue: the `#` heading
  becomes the summary and the rest the description. If the issue changed in
  Jira since your last download or push, the extension asks before
  overwriting it.
- **An unbound file** creates an issue. Paste a link to the epic it belongs to,
  or to a project, and choose Story or Task. Without a `#` heading, the file
  name is the summary.

The description is sent as HTML by default, which suits description fields
edited in a rich-text editor. Set `jiraToMd.descriptionFormat` to `wiki` for
the standard Jira wiki editor.

See [Binding and conversion](docs/BINDING.md) for the front matter format and
the Markdown that survives a round trip.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `jiraToMd.token` | — | API token (Cloud) or Personal Access Token (Server/DC), for all instances. |
| `jiraToMd.email` | — | Atlassian account e-mail. Cloud only. |
| `jiraToMd.downloadFolder` | — | Where to save issues. Empty = the active file's folder. Relative paths start at the workspace root; `~` and absolute paths work too. |
| `jiraToMd.askSubfolder` | `false` | Ask for an optional subfolder of the download folder, e.g. `services/account`. |
| `jiraToMd.descriptionFormat` | `html` | How Push writes the description: `html` for fields edited in a rich-text editor, `wiki` for the standard Jira wiki markup, `auto` to follow the issue's current format. |

The token is stored in VS Code settings, which may be synced or shared.
Restricted Mode is supported.

## API for other extensions

`jiraToMd.publishIssue` takes an optional `vscode.Uri` of a Markdown file and
pushes that file, read from disk, without opening it:

```js
const result = await vscode.commands.executeCommand('jiraToMd.publishIssue', fileUri);
```

| Outcome | Result |
|---|---|
| Pushed | `{ url: string, key: string, action: "created" \| "updated" }` |
| A prompt was cancelled | `undefined` |
| Failed | Rejects with an `Error`; `message` is ready to show to the user |

Prompts still appear when they are needed — for the token, the parent epic, or
an issue that changed in Jira — so call this only where a person can answer
them.

[MIT License](LICENSE) · [Changelog](CHANGELOG.md)
