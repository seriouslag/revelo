# Revelo

Rich hover cards and detail panels for **GitHub**, **Sentry**, and **Jira** references in your code comments and Markdown. Hover a reference to see live details; Cmd/Ctrl+click to open a full detail panel inside the editor.

Works in VS Code and Cursor.

## Features

- **GitHub** — issues, PRs, and discussions. Detects `#123`, `GH-123`, `owner/repo#123`, and full `github.com` URLs (including GitHub Enterprise). Shows title, state (open/closed/merged/draft with the correct color), author, labels, and a body snippet.
- **Sentry** — issues by URL or short ID (`PROJECT-42`). Shows title, level, status, event/user counts, and last-seen date. Region-aware (US/EU/self-hosted).
- **Jira** — issues by key (`ABC-123`) or Cloud/Server URL. Shows summary, status, type, priority, assignee, and description (Atlassian Document Format rendered inline).

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
  "revelo.jira.projectKeys": ["ABC", "PROJ"]
}
```

## Commands

| Command | Description |
|---|---|
| Revelo: Open Details | Open the detail panel for the last-hovered reference |
| Revelo: Sign in to GitHub | Authenticate GitHub via VS Code |
| Revelo: Set GitHub Token | Store a GitHub PAT |
| Revelo: Set Sentry Token | Store a Sentry auth token |
| Revelo: Set Jira Token | Store a Jira API token |
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
