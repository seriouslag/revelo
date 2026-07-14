import type { ReferenceMatcher } from '../../core/types';

// URL patterns run before the short-id pattern. Short IDs are ambiguous with
// ordinary hyphenated text (and Jira keys), so short-id detection is gated on
// configuration in the provider — the matcher only proposes candidates.
export const SENTRY_MATCHERS: ReferenceMatcher[] = [
  {
    kind: 'issue-url',
    regex:
      /https?:\/\/([a-z0-9.-]+)\/(?:organizations\/([\w-]+)\/)?issues\/(\d+)\/?(?:events\/([0-9a-f]{32})\/?)?/gi,
  },
  {
    // Full uppercased project slug (may contain hyphens) + numeric-ish suffix,
    // e.g. C3-FRONTEND-71 or CASH-SMARTCASH-HSBC-INTEGRATION-2. The greedy
    // prefix backtracks so the final segment becomes the suffix.
    kind: 'short-id',
    regex: /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-([0-9A-Z]{1,10})\b/g,
  },
];

export type ParsedSentryRef =
  | {
      kind: 'issue';
      host: string;
      orgSlug: string;
      issueId: string;
      eventId?: string;
    }
  | { kind: 'short-id'; shortId: string };

/**
 * Extract the org slug from a Sentry host of the form `<org>.sentry.io` or
 * `<org>.<region>.sentry.io`. Returns '' when the host has no org subdomain
 * (e.g. bare `sentry.io` or a self-hosted host).
 */
export function orgFromHost(host: string): string {
  const m = host.match(/^([\w-]+)\.(?:[a-z0-9-]+\.)?sentry\.io$/i);
  if (!m) {
    return '';
  }
  const sub = m[1].toLowerCase();
  // `us`, `us2`, `de` are region subdomains, not orgs.
  if (sub === 'us' || sub === 'us2' || sub === 'de' || sub === 'www') {
    return '';
  }
  return m[1];
}

/**
 * The project short-name prefix of a Sentry short id: everything before the
 * final hyphen. e.g. "CASH-SMARTCASH-HSBC-INTEGRATION-2" -> "CASH-SMARTCASH-HSBC-INTEGRATION".
 */
export function shortIdPrefix(shortId: string): string {
  const idx = shortId.lastIndexOf('-');
  return idx === -1 ? shortId.toUpperCase() : shortId.slice(0, idx).toUpperCase();
}

export function parseSentryMatch(kind: string, m: RegExpMatchArray): ParsedSentryRef | undefined {
  switch (kind) {
    case 'issue-url': {
      const [, host, pathOrg, issueId, eventId] = m;
      const orgSlug = pathOrg || orgFromHost(host);
      return { kind: 'issue', host, orgSlug, issueId, eventId };
    }
    case 'short-id': {
      return { kind: 'short-id', shortId: m[0] };
    }
    default:
      return undefined;
  }
}
