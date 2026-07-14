import { describe, it, expect, vi, beforeEach } from 'vitest';

const config = {
  get: vi.fn((key: string, def?: unknown) => {
    if (key === 'enabled') return true;
    if (key === 'defaultRepo') return 'octo/repo';
    if (key === 'ttlSeconds') return 300;
    return def;
  }),
};
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => config, workspaceFolders: [] },
  authentication: { getSession: vi.fn(async () => ({ accessToken: 'tok' })) },
}));

import { GitHubProvider } from '../providers/github/index';
import * as api from '../providers/github/api';

function makeProvider() {
  const secrets = {
    get: vi.fn(async () => undefined),
    store: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  return new GitHubProvider(secrets as never);
}

const ref = {
  providerId: 'github' as const,
  kind: 'issue',
  raw: 'octo/repo#5',
  key: 'github:github.com/octo/repo#5',
  fields: { host: 'github.com', owner: 'octo', repo: 'repo', number: '5' },
  range: undefined as never,
};

describe('GitHubProvider.editable', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('canEdit reflects enabled config', () => {
    expect(makeProvider().editable.canEdit()).toBe(true);
  });

  it('getOptions(assignee) lists assignable users as options', async () => {
    vi.spyOn(api.GitHubClient.prototype, 'listAssignableUsers').mockResolvedValue([
      { login: 'octocat' },
      { login: 'hubot' },
    ]);
    const opts = await makeProvider().editable.getOptions(ref, 'assignee', '');
    expect(opts).toEqual([
      { id: 'octocat', label: 'octocat' },
      { id: 'hubot', label: 'hubot' },
    ]);
  });

  it('getOptions(label) lists repo labels', async () => {
    vi.spyOn(api.GitHubClient.prototype, 'listRepoLabels').mockResolvedValue([
      { name: 'bug' },
      { name: 'docs' },
    ]);
    const opts = await makeProvider().editable.getOptions(ref, 'label', '');
    expect(opts.map((o) => o.id)).toEqual(['bug', 'docs']);
  });

  it('applyEdit(state) closes the issue', async () => {
    const spy = vi
      .spyOn(api.GitHubClient.prototype, 'updateState')
      .mockResolvedValue({ number: 5, title: 't', state: 'closed', html_url: 'u' });
    await makeProvider().editable.applyEdit(ref, { type: 'state', state: 'closed' });
    expect(spy).toHaveBeenCalledWith('octo', 'repo', '5', 'closed');
  });

  it('applyEdit(labels) replaces labels', async () => {
    const spy = vi.spyOn(api.GitHubClient.prototype, 'setLabels').mockResolvedValue({});
    await makeProvider().editable.applyEdit(ref, { type: 'labels', labels: ['bug'] });
    expect(spy).toHaveBeenCalledWith('octo', 'repo', '5', ['bug']);
  });

  it('applyEdit(assignees) replaces assignees', async () => {
    const spy = vi
      .spyOn(api.GitHubClient.prototype, 'setAssignees')
      .mockResolvedValue({ number: 5, title: 't', state: 'open', html_url: 'u' });
    await makeProvider().editable.applyEdit(ref, { type: 'assignees', logins: ['octocat'] });
    expect(spy).toHaveBeenCalledWith('octo', 'repo', '5', ['octocat']);
  });
});
