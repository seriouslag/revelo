# Revelo

Rich hover cards and detail panels for **GitHub**, **Sentry**, and **Jira** references in your code comments and Markdown. Hover a reference to see live details; Cmd/Ctrl+click to open a full detail panel inside the editor.

Works in VS Code and Cursor.

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/seriouslag.revelo.png?label=VS%20Code%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=seriouslag.revelo)
[![Open VSX (Cursor)](https://img.shields.io/open-vsx/v/seriouslag/revelo?label=Open%20VSX%20(Cursor)&logo=cursor)](https://open-vsx.org/extension/seriouslag/revelo)

## Features

- **GitHub** — issues, PRs, and discussions. Detects `#123`, `GH-123`, `owner/repo#123`, and full `github.com` URLs (including GitHub Enterprise). Shows title, state (open/closed/merged/draft with the correct color), author, labels, and a body snippet.
- **Sentry** — issues by URL or short ID (`PROJECT-42`). Shows title, level, status, event/user counts, and last-seen date. Region-aware (US/EU/self-hosted).
- **Jira** — issues by key (`ABC-123`) or Cloud/Server URL. Shows summary, status, type, priority, assignee, and description (Atlassian Document Format rendered inline).
- **Create Jira tickets from TODOs** — with `revelo.jira.requireTicketForTodo` on, `TODO`/`FIXME` comments without a linked ticket get a warning and a quick fix that opens a create form in the panel (summary, description with a source link, project, type, priority, assignee search, epic/parent search, labels, due date). Options (types, priorities, labels, epics) are fetched from Jira and prefetched at startup so the form opens instantly. On create it writes the new key back into the comment (`// TODO(ABC-123): …`) and opens the issue.
- **Ticket templates** — define reusable defaults in `revelo.jira.ticketTemplates` (project, type, priority, parent, labels, etc.). Each template adds its own "Create Jira {name} ticket from TODO" quick fix that opens the form pre-filled, and a template picker in the form lets you switch. Use `revelo.jira.visibleIssueTypes` / `visiblePriorities` / `visibleLabels` to trim long Jira lists down to the ones your team uses.

References are detected only inside **comments** (per-language) and **Markdown/plaintext** prose, so ordinary code isn't matched.

## Setup

References resolve against live APIs, so each provider needs credentials.

### GitHub

Uses your VS Code GitHub sign-in automatically — run **Revelo: Sign in to GitHub** (or **Set GitHub Token** to paste a PAT). Public repositories work unauthenticated at a lower rate limit.

Bare `#123` resolves against the workspace's `origin` git remote, or set `revelo.github.defaultRepo`.

### Sentry

1. Create a **User Auth Token** (User Settings → Auth Tokens) with `event:read`, `project:read`, `org:read`.
2. Run **Revelo: Set Sentry Token** and paste it.
3. Configure:

```jsonc
{
  "revelo.sentry.enabled": true,
  "revelo.sentry.orgSlug": "your-org",
  "revelo.sentry.apiBaseUrl": "https://your-org.sentry.io",
  // Only needed for bare short IDs — the uppercased project slugs:
  "revelo.sentry.shortIdPrefixes": ["BACKEND", "WEB"]
}
```

### Jira

1. Create an API token at [id.atlassian.com/manage/api-tokens](https://id.atlassian.com/manage/api-tokens).
2. Run **Revelo: Set Jira Token** and paste it.
3. Configure:

```jsonc
{
  "revelo.jira.enabled": true,
  "revelo.jira.siteUrl": "https://your-company.atlassian.net",
  "revelo.jira.email": "you@company.com",
  // Optional: restrict bare-key matching to your project keys
  "revelo.jira.projectKeys": ["ABC", "PROJ"],
  // Optional: templates that pre-fill the create form (name is required,
  // everything else optional). Each also adds a quick fix.
  "revelo.jira.ticketTemplates": [
    { "name": "Bug", "projectKey": "ABC", "issueType": "Bug", "priorityId": "2", "labels": ["triage"] }
  ]
}
```

> Tip: priority and assignee use internal Jira ids. Enable `revelo.jira.debug` to show them beside each option in the create form, then copy the id into your template.

## Commands

| Command | Description |
|---|---|
| Revelo: Open Details | Open the detail panel for the last-hovered reference |
| Revelo: Sign in to GitHub | Authenticate GitHub via VS Code |
| Revelo: Set GitHub Token | Store a GitHub PAT |
| Revelo: Set Sentry Token | Store a Sentry auth token |
| Revelo: Set Jira Token | Store a Jira API token |
| Revelo: Create Jira Ticket from TODO | Create a Jira issue from the TODO on the current line |
| Revelo: Clear Cache | Clear cached reference details |

## Settings

| Setting | Default | Description |
|---|---|---|
| `revelo.github.enabled` | `true` | Enable GitHub detection |
| `revelo.github.defaultRepo` | `""` | Fallback `owner/repo` for bare `#123` |
| `revelo.sentry.enabled` | `false` | Enable Sentry detection |
| `revelo.sentry.apiBaseUrl` | `https://sentry.io` | Sentry base URL (region or self-hosted) |
| `revelo.sentry.orgSlug` | `""` | Default Sentry org slug |
| `revelo.sentry.shortIdPrefixes` | `[]` | Uppercased project slugs to match as short IDs |
| `revelo.sentry.enableEditing` | `false` | Show status-edit controls (needs `event:write` token scope) |
| `revelo.jira.enabled` | `false` | Enable Jira detection |
| `revelo.jira.siteUrl` | `""` | Jira Cloud site URL |
| `revelo.jira.email` | `""` | Atlassian account email |
| `revelo.jira.projectKeys` | `[]` | Project keys to match (empty = any non-denylisted) |
| `revelo.jira.requireTicketForTodo` | `false` | Warn on TODO comments with no linked Jira ticket |
| `revelo.jira.todoKeywords` | `["TODO", "FIXME"]` | Comment keywords that trigger TODO detection |
| `revelo.jira.ticketTemplates` | `[]` | Saved templates that pre-populate the create form. Each needs a `name`; other fields (`projectKey`, `issueType`, `priorityId`, `parentKey`, `labels`, `assigneeAccountId`, `dueDate`) are optional. Each template also becomes a "Create Jira {name} ticket from TODO" quick fix |
| `revelo.jira.visibleIssueTypes` | `[]` | Restrict the Type dropdown to these issue type names (empty = all types from Jira) |
| `revelo.jira.visiblePriorities` | `[]` | Restrict the Priority dropdown, matched by id or name (empty = all) |
| `revelo.jira.visibleLabels` | `[]` | Restrict the label suggestions (empty = all; free-text labels always allowed) |
| `revelo.jira.prefetchEpicsMaxProjects` | `5` | Prefetch epics at startup for each configured project key, only when there are at most this many keys (`0` disables) |
| `revelo.jira.debug` | `false` | Show internal Jira ids (priority, assignee) in the create form to help discover ids for templates |
| `revelo.cache.ttlSeconds` | `300` | How long fetched details are cached |

## Editing

The detail panel (Cmd/Ctrl+click a reference) can edit issues, not just view them:

- **GitHub** — close/reopen, set assignee, edit labels. Controls appear only when your token has push access to that specific repo.
- **Jira** — change status (transition), set assignee, edit description. Each control appears only if you have the matching permission on that issue (`TRANSITION_ISSUES`, `ASSIGN_ISSUES`, `EDIT_ISSUES`).
- **Sentry** — change status (resolve/ignore/unresolve). Off by default; enable with `revelo.sentry.enableEditing` and a token with `event:write`.

## Privacy

Tokens are stored in VS Code's encrypted **SecretStorage**, never in settings files. Reference details are fetched directly from your configured GitHub/Sentry/Jira instances and cached in memory only.

## License

MIT
