import { describe, it, expect } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { JiraClient, JiraAuthError, JiraNotFoundError } from '../providers/jira/api';

// jira.js runs on axios; inject an adapter that records the request config and
// returns a canned response (or throws an HttpException-shaped error on error).
function recorder(body: unknown, status = 200) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config as InternalAxiosRequestConfig);
    if (status >= 400) {
      const err = Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data: body, headers: {}, config, statusText: '' },
        config,
      });
      throw err;
    }
    return {
      data: body,
      status,
      statusText: 'OK',
      headers: {},
      config: config as InternalAxiosRequestConfig,
    };
  };
  return { adapter, calls };
}

function makeClient(rec: { adapter: AxiosAdapter }, overrides: Partial<{ email: string; token: string; siteUrl: string }> = {}) {
  return new JiraClient({
    siteUrl: overrides.siteUrl ?? 'https://a.atlassian.net',
    email: overrides.email ?? 'e',
    token: overrides.token ?? 't',
    adapter: rec.adapter,
  });
}

describe('JiraClient.fetchIssue', () => {
  it('sends Basic auth and requests the issue with fields', async () => {
    const rec = recorder({ key: 'ABC-1', fields: { summary: 'Bug' } });
    const client = makeClient(rec, { email: 'me@x.com', token: 'tok', siteUrl: 'https://acme.atlassian.net' });
    const issue = await client.fetchIssue('ABC-1');
    expect(issue.fields.summary).toBe('Bug');

    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/rest/api/3/issue/ABC-1');
    expect((cfg.params as { fields?: string[] }).fields).toContain('summary');
    const auth = (cfg.headers as Record<string, string>).Authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    expect(decoded).toBe('me@x.com:tok');
  });

  it('strips a trailing slash from the site url', async () => {
    const rec = recorder({ key: 'A-1', fields: {} });
    const client = makeClient(rec, { siteUrl: 'https://acme.atlassian.net/' });
    await client.fetchIssue('A-1');
    expect(rec.calls[0].baseURL).toBe('https://acme.atlassian.net');
  });

  it('throws JiraAuthError on 401', async () => {
    const client = makeClient(recorder({}, 401));
    await expect(client.fetchIssue('A-1')).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('throws JiraNotFoundError on 404', async () => {
    const client = makeClient(recorder({}, 404));
    await expect(client.fetchIssue('A-1')).rejects.toBeInstanceOf(JiraNotFoundError);
  });
});

describe('JiraClient write operations', () => {
  it('lists transitions', async () => {
    const rec = recorder({ transitions: [{ id: '31', name: 'Done' }] });
    const t = await makeClient(rec).getTransitions('A-1');
    expect(t).toEqual([{ id: '31', name: 'Done' }]);
    expect(rec.calls[0].url).toContain('/issue/A-1/transitions');
  });

  it('POSTs a transition with the id', async () => {
    const rec = recorder({});
    await makeClient(rec).doTransition('A-1', '31');
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/issue/A-1/transitions');
    expect(cfg.method).toBe('post');
    expect(JSON.parse(cfg.data as string)).toEqual({ transition: { id: '31' } });
  });

  it('searches assignable users', async () => {
    const rec = recorder([{ accountId: 'a1', displayName: 'Jane' }]);
    const users = await makeClient(rec).getAssignableUsers('A-1', 'jan');
    expect(users[0].displayName).toBe('Jane');
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/user/assignable/search');
    expect((cfg.params as { issueKey?: string; query?: string })).toMatchObject({
      issueKey: 'A-1',
      query: 'jan',
    });
  });

  it('PUTs an assignee accountId', async () => {
    const rec = recorder({});
    await makeClient(rec).updateAssignee('A-1', 'a1');
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/issue/A-1/assignee');
    expect(cfg.method).toBe('put');
    expect(JSON.parse(cfg.data as string)).toEqual({ accountId: 'a1' });
  });

  it('unassigns with null accountId', async () => {
    const rec = recorder({});
    await makeClient(rec).updateAssignee('A-1', null);
    expect(JSON.parse(rec.calls[0].data as string)).toEqual({ accountId: null });
  });

  it('PUTs a description as ADF', async () => {
    const rec = recorder({});
    const adf = { type: 'doc', version: 1, content: [] };
    await makeClient(rec).updateDescription('A-1', adf);
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/issue/A-1');
    expect(cfg.method).toBe('put');
    expect(JSON.parse(cfg.data as string)).toEqual({ fields: { description: adf } });
  });

  it('POSTs a new issue and returns its key', async () => {
    const rec = recorder({ id: '10001', key: 'ABC-42', self: 'https://a/rest/api/3/issue/10001' });
    const key = await makeClient(rec).createIssue({
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 'Fix the thing',
    });
    expect(key).toBe('ABC-42');
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/issue');
    expect(cfg.method).toBe('post');
    expect(JSON.parse(cfg.data as string)).toEqual({
      fields: { project: { key: 'ABC' }, issuetype: { name: 'Task' }, summary: 'Fix the thing' },
    });
  });

  it('includes an ADF description when provided', async () => {
    const rec = recorder({ id: '1', key: 'ABC-43', self: 's' });
    const adf = { type: 'doc', version: 1, content: [] };
    await makeClient(rec).createIssue({
      projectKey: 'ABC',
      issueType: 'Bug',
      summary: 'Boom',
      description: adf,
    });
    expect(JSON.parse(rec.calls[0].data as string).fields.description).toEqual(adf);
  });
});

describe('JiraClient.getMyPermissions', () => {
  it('maps permission booleans and queries the issue', async () => {
    const rec = recorder({
      permissions: {
        EDIT_ISSUES: { havePermission: true },
        ASSIGN_ISSUES: { havePermission: false },
        TRANSITION_ISSUES: { havePermission: true },
      },
    });
    const perms = await makeClient(rec).getMyPermissions('ABC-1');
    expect(perms).toEqual({ edit: true, assign: false, transition: true });
    const cfg = rec.calls[0];
    expect(cfg.url).toContain('/mypermissions');
    expect((cfg.params as { issueKey?: string; permissions?: string })).toMatchObject({
      issueKey: 'ABC-1',
    });
    expect((cfg.params as { permissions?: string }).permissions).toContain('EDIT_ISSUES');
  });

  it('defaults missing permissions to false', async () => {
    const rec = recorder({ permissions: {} });
    const perms = await makeClient(rec).getMyPermissions('ABC-1');
    expect(perms).toEqual({ edit: false, assign: false, transition: false });
  });
});
