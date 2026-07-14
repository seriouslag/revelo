import type { AdfNode } from './adf';

export interface JiraStatus {
  name?: string;
  statusCategory?: { key?: string; name?: string };
}

export interface JiraNamed {
  name?: string;
  displayName?: string;
  iconUrl?: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: JiraStatus;
    assignee?: JiraNamed | null;
    reporter?: JiraNamed | null;
    priority?: JiraNamed | null;
    issuetype?: JiraNamed | null;
    description?: AdfNode | string | null;
    created?: string;
    updated?: string;
    labels?: string[];
  };
}

export class JiraAuthError extends Error {
  constructor() {
    super('Jira authentication failed');
    this.name = 'JiraAuthError';
  }
}

export class JiraNotFoundError extends Error {
  constructor() {
    super('Jira issue not found');
    this.name = 'JiraNotFoundError';
  }
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string; statusCategory?: { key?: string } };
}

export interface JiraAssignableUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraPermissions {
  edit: boolean;
  assign: boolean;
  transition: boolean;
}

export interface JiraClientOptions {
  siteUrl: string; // e.g. https://acme.atlassian.net
  email: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const ISSUE_FIELDS =
  'summary,status,assignee,reporter,priority,issuetype,description,created,updated,labels';

export class JiraClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: JiraClientOptions) {
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private authHeader(): string {
    const raw = `${this.options.email}:${this.options.token}`;
    // btoa is available in the extension host (Node 18+/browser).
    const encoded =
      typeof btoa === 'function'
        ? btoa(raw)
        : Buffer.from(raw, 'utf-8').toString('base64');
    return `Basic ${encoded}`;
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const base = this.options.siteUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json',
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await this.doFetch(`${base}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      throw new JiraAuthError();
    }
    if (res.status === 404) {
      throw new JiraNotFoundError();
    }
    if (!res.ok) {
      throw new Error(`Jira API error ${res.status}`);
    }
    // 204 No Content (writes) has no JSON body.
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  fetchIssue(key: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`,
    );
  }

  /**
   * Which edit permissions the current user has on an issue. Returns booleans
   * for EDIT_ISSUES, ASSIGN_ISSUES, TRANSITION_ISSUES so the panel can gate
   * each control independently.
   */
  async getMyPermissions(key: string): Promise<JiraPermissions> {
    const perms = 'EDIT_ISSUES,ASSIGN_ISSUES,TRANSITION_ISSUES';
    const res = await this.request<{
      permissions?: Record<string, { havePermission?: boolean }>;
    }>(`/rest/api/3/mypermissions?issueKey=${encodeURIComponent(key)}&permissions=${perms}`);
    const p = res.permissions ?? {};
    return {
      edit: Boolean(p.EDIT_ISSUES?.havePermission),
      assign: Boolean(p.ASSIGN_ISSUES?.havePermission),
      transition: Boolean(p.TRANSITION_ISSUES?.havePermission),
    };
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    const res = await this.request<{ transitions: JiraTransition[] }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    );
    return res.transitions ?? [];
  }

  doTransition(key: string, transitionId: string): Promise<void> {
    return this.request<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      body: { transition: { id: transitionId } },
    });
  }

  async getAssignableUsers(key: string, query: string): Promise<JiraAssignableUser[]> {
    const params = new URLSearchParams({ issueKey: key, query, maxResults: '50' });
    return this.request<JiraAssignableUser[]>(
      `/rest/api/3/user/assignable/search?${params.toString()}`,
    );
  }

  /** Assign to an accountId, or pass null to unassign. */
  updateAssignee(key: string, accountId: string | null): Promise<void> {
    return this.request<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, {
      method: 'PUT',
      body: { accountId },
    });
  }

  updateDescription(key: string, description: AdfNode): Promise<void> {
    return this.request<void>(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { fields: { description } },
    });
  }
}
