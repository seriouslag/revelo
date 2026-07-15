import { getOrganizationIssueQueryResponseSchema } from './gen/zod/getOrganizationIssueSchema';
import { resolveOrganizationShortIdQueryResponseSchema } from './gen/zod/resolveOrganizationShortIdSchema';

export interface SentryProjectRef {
  id?: string;
  name?: string;
  slug?: string;
  platform?: string;
}

export interface SentryActor {
  name?: string;
  email?: string;
  type?: string;
}

export interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string;
  permalink?: string;
  level?: string;
  status?: string;
  substatus?: string | null;
  priority?: string;
  platform?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  project?: SentryProjectRef;
  assignedTo?: SentryActor | null;
  metadata?: { type?: string; value?: string; filename?: string };
}

export interface ShortIdResolution {
  shortId: string;
  groupId: string;
  organizationSlug: string;
  projectSlug: string;
  group: SentryIssue;
}

export class SentryAuthError extends Error {
  constructor() {
    super('Sentry authentication failed');
    this.name = 'SentryAuthError';
  }
}

export class SentryNotFoundError extends Error {
  constructor() {
    super('Sentry resource not found');
    this.name = 'SentryNotFoundError';
  }
}

export class SentryRateLimitError extends Error {
  constructor(public readonly resetEpoch?: number) {
    super('Sentry rate limit exceeded');
    this.name = 'SentryRateLimitError';
  }
}

export interface SentryClientOptions {
  baseUrl: string; // e.g. https://sentry.io  (no trailing /api/0)
  token: string;
  fetchImpl?: typeof fetch;
}

// A zod schema exposes safeParse; we validate leniently (see validate()).
interface LenientSchema {
  safeParse(data: unknown): { success: boolean; error?: unknown };
}

export class SentryClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: SentryClientOptions) {
    this.doFetch = options.fetchImpl ?? fetch;
  }

  // Validate against the generated schema for observability only. Sentry's real
  // payloads don't always satisfy every field the spec marks required, so a
  // failed parse must not break rendering — we warn and use the raw data.
  private validate<T>(schema: LenientSchema, data: unknown, label: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(`Revelo: Sentry ${label} response did not match schema`, result.error);
    }
    return data as T;
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: 'application/json',
    };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await this.doFetch(`${base}/api/0${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      throw new SentryAuthError();
    }
    if (res.status === 404) {
      throw new SentryNotFoundError();
    }
    if (res.status === 429) {
      const reset = res.headers.get('x-sentry-rate-limit-reset');
      throw new SentryRateLimitError(reset ? Number(reset) : undefined);
    }
    if (!res.ok) {
      throw new Error(`Sentry API error ${res.status}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async fetchIssue(orgSlug: string, issueId: string): Promise<SentryIssue> {
    const data = await this.request<unknown>(`/organizations/${orgSlug}/issues/${issueId}/`);
    return this.validate<SentryIssue>(getOrganizationIssueQueryResponseSchema, data, 'issue');
  }

  async resolveShortId(orgSlug: string, shortId: string): Promise<ShortIdResolution> {
    const data = await this.request<unknown>(
      `/organizations/${orgSlug}/shortids/${encodeURIComponent(shortId)}/`,
    );
    return this.validate<ShortIdResolution>(
      resolveOrganizationShortIdQueryResponseSchema,
      data,
      'shortId',
    );
  }

  /** Update an issue's status (resolved / ignored / unresolved). */
  updateStatus(
    orgSlug: string,
    issueId: string,
    status: 'resolved' | 'ignored' | 'unresolved',
  ): Promise<SentryIssue> {
    return this.request<SentryIssue>(`/organizations/${orgSlug}/issues/${issueId}/`, {
      method: 'PUT',
      body: { status },
    });
  }

  /** Assign an issue to an actor (e.g. "user:123"), or null to unassign. */
  updateAssignee(orgSlug: string, issueId: string, assignedTo: string | null): Promise<SentryIssue> {
    return this.request<SentryIssue>(`/organizations/${orgSlug}/issues/${issueId}/`, {
      method: 'PUT',
      body: { assignedTo },
    });
  }
}
