import { describe, it, expect, vi, beforeEach } from 'vitest';

const config = {
  get: vi.fn((key: string, def?: unknown) => {
    if (key === 'enabled') return true;
    if (key === 'enableEditing') return true;
    if (key === 'orgSlug') return 'acme';
    if (key === 'apiBaseUrl') return 'https://sentry.io';
    if (key === 'ttlSeconds') return 300;
    return def;
  }),
};
const secretValue = { current: 'tok' as string | undefined };
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => config },
}));

import { SentryProvider } from '../providers/sentry/index';
import * as api from '../providers/sentry/api';

function makeProvider() {
  const secrets = {
    get: vi.fn(async () => secretValue.current),
    store: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  return new SentryProvider(secrets as never);
}

const urlRef = {
  providerId: 'sentry' as const,
  kind: 'issue',
  raw: 'https://acme.sentry.io/issues/123/',
  key: 'sentry:acme.sentry.io/acme/issues/123',
  fields: { host: 'acme.sentry.io', orgSlug: 'acme', issueId: '123', eventId: '' },
  range: undefined as never,
};

describe('SentryProvider.editable', () => {
  beforeEach(() => {
    secretValue.current = 'tok';
    vi.restoreAllMocks();
  });

  it('canEdit requires both enabled and enableEditing', () => {
    expect(makeProvider().editable.canEdit()).toBe(true);
  });

  it('applyEdit(sentryStatus) resolves the issue', async () => {
    const spy = vi
      .spyOn(api.SentryClient.prototype, 'updateStatus')
      .mockResolvedValue({ id: '123', title: 't' });
    await makeProvider().editable.applyEdit(urlRef, { type: 'sentryStatus', status: 'resolved' });
    expect(spy).toHaveBeenCalledWith('acme', '123', 'resolved');
  });

  it('resolves a short-id to org + issue id before editing', async () => {
    const shortRef = {
      ...urlRef,
      kind: 'short-id',
      raw: 'BACKEND-42',
      key: 'sentry:shortid/BACKEND-42',
      fields: { shortId: 'BACKEND-42' },
    };
    vi.spyOn(api.SentryClient.prototype, 'resolveShortId').mockResolvedValue({
      shortId: 'BACKEND-42',
      groupId: '999',
      organizationSlug: 'acme',
      projectSlug: 'backend',
      group: { id: '999', title: 'E' },
    });
    const spy = vi
      .spyOn(api.SentryClient.prototype, 'updateStatus')
      .mockResolvedValue({ id: '999', title: 'E' });
    await makeProvider().editable.applyEdit(shortRef, { type: 'sentryStatus', status: 'ignored' });
    expect(spy).toHaveBeenCalledWith('acme', '999', 'ignored');
  });

  it('rejects unsupported edit actions', async () => {
    await expect(
      makeProvider().editable.applyEdit(urlRef, { type: 'state', state: 'closed' }),
    ).rejects.toThrow(/Unsupported/);
  });

  it('throws when no token is configured', async () => {
    secretValue.current = undefined;
    await expect(
      makeProvider().editable.applyEdit(urlRef, { type: 'sentryStatus', status: 'resolved' }),
    ).rejects.toThrow(/token/i);
  });
});
