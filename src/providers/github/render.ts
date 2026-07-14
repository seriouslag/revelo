import type { GitHubIssue } from './api';
import type { StateBadge } from '../../core/types';

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, (c) => `\\${c}`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function labelNames(issue: GitHubIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

export function deriveState(issue: GitHubIssue): StateBadge {
  const isPr =
    Boolean(issue.pull_request) || issue.merged !== undefined || issue.draft !== undefined;

  if (isPr) {
    if (issue.merged || issue.pull_request?.merged_at) {
      return { label: 'Merged', kind: 'merged' };
    }
    if (issue.state === 'closed') {
      // A closed-but-unmerged PR.
      return { label: 'Closed', kind: 'closed-pr' };
    }
    if (issue.draft) {
      return { label: 'Draft', kind: 'draft' };
    }
    return { label: 'Open', kind: 'open' };
  }

  if (issue.state === 'closed') {
    // Issues distinguish completed vs. not-planned via state_reason.
    return issue.state_reason === 'not_planned'
      ? { label: 'Closed (not planned)', kind: 'closed-notplanned' }
      : { label: 'Closed', kind: 'closed-completed' };
  }
  return { label: 'Open', kind: 'open' };
}

const BADGE_EMOJI: Record<StateBadge['kind'], string> = {
  open: '\u{1F7E2}', // green circle
  'closed-completed': '\u{1F7E3}', // purple circle
  'closed-notplanned': '\u{26AB}', // black circle (gray-ish)
  'closed-pr': '\u{1F534}', // red circle
  merged: '\u{1F7E3}', // purple circle
  draft: '\u{26AA}', // white circle
  resolved: '✅',
  unresolved: '\u{1F534}', // red circle (active Sentry error)
  'in-progress': '\u{1F7E1}', // yellow circle (Jira work in progress)
  unknown: '⚫',
};

export function stateEmoji(kind: StateBadge['kind']): string {
  return BADGE_EMOJI[kind];
}

/** Build a user profile URL on the same host as the issue/PR URL. */
export function authorUrl(itemHtmlUrl: string, login: string): string {
  try {
    const origin = new URL(itemHtmlUrl).origin;
    return `${origin}/${login}`;
  } catch {
    return `https://github.com/${login}`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO date as "Dec 4, 2023"; returns '' for missing/invalid input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * Turn a raw GitHub markdown body into a short plain-text snippet suitable for
 * a hover card: strip HTML comments (PR templates), images, and headings,
 * collapse whitespace, then truncate on a word boundary.
 */
export function cleanBody(body: string | null | undefined, max = 200): string {
  if (!body) {
    return '';
  }
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments (PR templates)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (text.length <= max) {
    return text;
  }
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}
