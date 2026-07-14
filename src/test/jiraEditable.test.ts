import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode so the provider module can be imported in a node test env.
const config = {
  get: vi.fn((key: string, def?: unknown) => {
    if (key === 'enabled') return true;
    if (key === 'email') return 'me@x.com';
    if (key === 'siteUrl') return 'https://acme.atlassian.net';
    if (key === 'projectKeys') return [];
    if (key === 'ttlSeconds') return 300;
    return def;
  }),
};
const secretValue = { current: 'tok' as string | undefined };
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => config },
}));

import { JiraProvider } from '../providers/jira/index';
import * as api from '../providers/jira/api';

function makeProvider() {
  const secrets = {
    get: vi.fn(async () => secretValue.current),
    store: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  // The provider expects a SecretStorage-shaped object.
  return new JiraProvider(secrets as never);
}

const ref = {
  providerId: 'jira' as const,
  kind: 'issue',
  raw: 'ABC-1',
  key: 'jira:ABC-1',
  fields: { issueKey: 'ABC-1' },
  range: undefined as never,
};

describe('JiraProvider.editable', () => {
  beforeEach(() => {
    secretValue.current = 'tok';
    vi.restoreAllMocks();
  });

  it('canEdit reflects enabled config', () => {
    expect(makeProvider().editable.canEdit(ref)).toBe(true);
  });

  it('getOptions(transition) maps transitions to options', async () => {
    vi.spyOn(api.JiraClient.prototype, 'getTransitions').mockResolvedValue([
      { id: '31', name: 'Done', to: { name: 'Done' } },
      { id: '21', name: 'Start', to: { name: 'In Progress' } },
    ]);
    const opts = await makeProvider().editable.getOptions(ref, 'transition', '');
    expect(opts).toEqual([
      { id: '31', label: 'Done' },
      { id: '21', label: 'In Progress' },
    ]);
  });

  it('getOptions(assignee) maps users with email', async () => {
    vi.spyOn(api.JiraClient.prototype, 'getAssignableUsers').mockResolvedValue([
      { accountId: 'a1', displayName: 'Jane', emailAddress: 'jane@x.com' },
      { accountId: 'a2', displayName: 'Bob' },
    ]);
    const opts = await makeProvider().editable.getOptions(ref, 'assignee', 'j');
    expect(opts).toEqual([
      { id: 'a1', label: 'Jane (jane@x.com)' },
      { id: 'a2', label: 'Bob' },
    ]);
  });

  it('applyEdit(transition) calls doTransition', async () => {
    const spy = vi.spyOn(api.JiraClient.prototype, 'doTransition').mockResolvedValue();
    await makeProvider().editable.applyEdit(ref, { type: 'transition', transitionId: '31' });
    expect(spy).toHaveBeenCalledWith('ABC-1', '31');
  });

  it('applyEdit(assign) calls updateAssignee', async () => {
    const spy = vi.spyOn(api.JiraClient.prototype, 'updateAssignee').mockResolvedValue();
    await makeProvider().editable.applyEdit(ref, { type: 'assign', accountId: 'a1' });
    expect(spy).toHaveBeenCalledWith('ABC-1', 'a1');
  });

  it('applyEdit(description) converts text to ADF and updates', async () => {
    const spy = vi.spyOn(api.JiraClient.prototype, 'updateDescription').mockResolvedValue();
    await makeProvider().editable.applyEdit(ref, { type: 'description', text: 'hello' });
    expect(spy).toHaveBeenCalledOnce();
    const [key, adf] = spy.mock.calls[0];
    expect(key).toBe('ABC-1');
    expect(adf).toMatchObject({ type: 'doc', version: 1 });
  });

  it('throws a helpful error when no token is set', async () => {
    secretValue.current = undefined;
    await expect(
      makeProvider().editable.getOptions(ref, 'transition', ''),
    ).rejects.toThrow(/token/i);
  });
});
