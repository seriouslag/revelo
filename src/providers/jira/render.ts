import type { StateBadge, StateKind } from '../../core/types';
import type { JiraIssue } from './api';

// Jira statusCategory.key is one of: new, indeterminate, done.
const CATEGORY_KIND: Record<string, StateKind> = {
  new: 'open',
  indeterminate: 'in-progress',
  done: 'resolved',
};

export function deriveJiraState(issue: JiraIssue): StateBadge {
  const status = issue.fields.status;
  const label = status?.name ?? 'Unknown';
  const categoryKey = status?.statusCategory?.key ?? '';
  return { label, kind: CATEGORY_KIND[categoryKey] ?? 'unknown' };
}

export function actorName(actor: JiraIssue['fields']['assignee']): string {
  if (!actor) {
    return '';
  }
  return actor.displayName ?? actor.name ?? '';
}
