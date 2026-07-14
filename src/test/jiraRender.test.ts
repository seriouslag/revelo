import { describe, it, expect } from 'vitest';
import { deriveJiraState, actorName } from '../providers/jira/render';
import type { JiraIssue } from '../providers/jira/api';

function issue(fields: Partial<JiraIssue['fields']>): JiraIssue {
  return { key: 'ABC-1', fields };
}

describe('deriveJiraState', () => {
  it('maps new category to open', () => {
    expect(
      deriveJiraState(issue({ status: { name: 'To Do', statusCategory: { key: 'new' } } })),
    ).toEqual({ label: 'To Do', kind: 'open' });
  });
  it('maps indeterminate to in-progress', () => {
    expect(
      deriveJiraState(
        issue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
      ),
    ).toEqual({ label: 'In Progress', kind: 'in-progress' });
  });
  it('maps done to resolved', () => {
    expect(
      deriveJiraState(issue({ status: { name: 'Done', statusCategory: { key: 'done' } } })),
    ).toEqual({ label: 'Done', kind: 'resolved' });
  });
  it('falls back to unknown', () => {
    expect(deriveJiraState(issue({}))).toEqual({ label: 'Unknown', kind: 'unknown' });
  });
});

describe('actorName', () => {
  it('prefers displayName', () => {
    expect(actorName({ displayName: 'Jane Doe', name: 'jdoe' })).toBe('Jane Doe');
  });
  it('falls back to name', () => {
    expect(actorName({ name: 'jdoe' })).toBe('jdoe');
  });
  it('returns empty for null', () => {
    expect(actorName(null)).toBe('');
  });
});
