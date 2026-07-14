import type { ReferenceMatcher } from '../../core/types';

// URL patterns run before the bare-key pattern. Bare keys are ambiguous with
// hyphenated tokens like UTF-8, so the provider gates them on a project-key
// allowlist and a denylist (below).
export const JIRA_MATCHERS: ReferenceMatcher[] = [
  {
    kind: 'cloud-url',
    regex: /https?:\/\/([a-z0-9-]+)\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/g,
  },
  {
    kind: 'server-url',
    regex: /https?:\/\/[^\s/]+(?:\/[^\s/]+)*?\/browse\/([A-Z][A-Z0-9]+-\d+)/g,
  },
  {
    kind: 'key',
    regex: /\b([A-Z][A-Z0-9]+)-(\d+)\b/g,
  },
];

// Common ALLCAPS-number tokens that are not Jira keys.
export const KEY_DENYLIST = new Set([
  'UTF',
  'SHA',
  'HTTP',
  'HTTPS',
  'ISO',
  'RFC',
  'UTC',
  'AES',
  'SSL',
  'TLS',
  'IPV',
  'IP',
  'BASE',
  'MD',
  'CVE',
  'PEP',
  'ES',
  'EC',
  'GB',
  'MB',
  'KB',
]);

export type ParsedJiraRef =
  | { kind: 'issue'; site: string; key: string }
  | { kind: 'key'; key: string };

export function parseJiraMatch(kind: string, m: RegExpMatchArray): ParsedJiraRef | undefined {
  switch (kind) {
    case 'cloud-url':
      return { kind: 'issue', site: m[1], key: m[2] };
    case 'server-url':
      // Server URL has no atlassian.net site subdomain; site resolved from config.
      return { kind: 'key', key: m[1] };
    case 'key':
      return { kind: 'key', key: `${m[1]}-${m[2]}` };
    default:
      return undefined;
  }
}

/** The project key portion of an issue key, e.g. "ABC-123" -> "ABC". */
export function projectKeyOf(issueKey: string): string {
  return issueKey.slice(0, issueKey.lastIndexOf('-'));
}
