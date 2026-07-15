# Changelog

Stable releases use even minor versions (`0.2.x`, `0.4.x`); pre-releases
published from `main` use odd minor versions (`0.1.x`, `0.3.x`), per the
VS Code Marketplace convention.

## 0.1.0

- Jira ticket templates (`revelo.jira.ticketTemplates`) that pre-populate the create-from-TODO form, each surfacing its own quick fix and an in-form picker.
- Create-form options (issue types, priorities, labels, epics) are fetched from Jira and prefetched at startup so the form opens instantly, with a loading state and graceful error handling when Jira is unreachable.
- Filter settings `revelo.jira.visibleIssueTypes`, `visiblePriorities`, and `visibleLabels` to trim long Jira lists; searchable Type combobox and toggle-chip labels for short/curated lists.
- `revelo.jira.debug` surfaces internal Jira ids in the create form; `revelo.jira.prefetchEpicsMaxProjects` bounds startup epic prefetching.
- Removed `revelo.jira.issueTypes` in favour of the list fetched from Jira.

## 0.0.1

Initial release.

- GitHub: hover cards and detail panels for issues, PRs, and discussions. Detects `#123`, `GH-123`, `owner/repo#123`, and `github.com` URLs (including GitHub Enterprise). Native GitHub sign-in or PAT.
- Sentry: hover cards for issues by URL or short ID. Region-aware (US/EU/self-hosted).
- Jira: hover cards for issues by key or URL, with Atlassian Document Format descriptions rendered inline.
- References detected inside code comments (per-language) and Markdown/plaintext prose.
- Tokens stored in VS Code SecretStorage; in-memory caching with configurable TTL.
