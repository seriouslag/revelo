import type { StateBadge } from '../../core/types';
import type { SentryIssue } from './api';

export function deriveSentryState(issue: SentryIssue): StateBadge {
  switch (issue.status) {
    case 'resolved':
      return { label: 'Resolved', kind: 'resolved' };
    case 'ignored':
    case 'muted':
      return { label: 'Ignored', kind: 'closed-notplanned' };
    case 'unresolved':
      return { label: 'Unresolved', kind: 'unresolved' };
    default:
      return { label: issue.status ?? 'Unknown', kind: 'unknown' };
  }
}

const LEVEL_EMOJI: Record<string, string> = {
  fatal: '\u{1F480}', // skull
  error: '\u{1F534}', // red circle
  warning: '\u{1F7E1}', // yellow circle
  info: '\u{1F535}', // blue circle
  debug: '\u{26AA}', // white circle
};

export function levelEmoji(level: string | undefined): string {
  if (!level) {
    return '';
  }
  return LEVEL_EMOJI[level.toLowerCase()] ?? '';
}

export function formatCount(count: string | number | undefined): string {
  const n = typeof count === 'string' ? Number(count) : count;
  if (n === undefined || Number.isNaN(n)) {
    return '0';
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

export function assigneeName(issue: SentryIssue): string {
  const a = issue.assignedTo;
  if (!a) {
    return '';
  }
  return a.name ?? a.email ?? '';
}
