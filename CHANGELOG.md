# Changelog

## 0.0.1

Initial release.

- GitHub: hover cards and detail panels for issues, PRs, and discussions. Detects `#123`, `GH-123`, `owner/repo#123`, and `github.com` URLs (including GitHub Enterprise). Native GitHub sign-in or PAT.
- Sentry: hover cards for issues by URL or short ID. Region-aware (US/EU/self-hosted).
- Jira: hover cards for issues by key or URL, with Atlassian Document Format descriptions rendered inline.
- References detected inside code comments (per-language) and Markdown/plaintext prose.
- Tokens stored in VS Code SecretStorage; in-memory caching with configurable TTL.
