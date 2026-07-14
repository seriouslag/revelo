export interface GitHubUser {
  login: string;
  avatar_url?: string;
}

export interface GitHubLabel {
  name: string;
  color?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  html_url: string;
  body?: string | null;
  user?: GitHubUser | null;
  labels?: Array<GitHubLabel | string>;
  assignees?: GitHubUser[];
  comments?: number;
  created_at?: string;
  updated_at?: string;
  pull_request?: { merged_at?: string | null };
  draft?: boolean;
  merged?: boolean;
}

export interface FetchResult {
  data: GitHubIssue;
  etag?: string;
}

export interface GitHubClientOptions {
  baseUrl: string;
  token?: string;
  // Injectable for testing; defaults to global fetch.
  fetchImpl?: typeof fetch;
}

export class RateLimitError extends Error {
  constructor(public readonly resetEpoch?: number) {
    super('GitHub rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

interface CachedEtag {
  etag: string;
  data: GitHubIssue;
}

export class GitHubClient {
  private readonly etags = new Map<string, CachedEtag>();
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private headers(etag?: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.options.token) {
      h.Authorization = `Bearer ${this.options.token}`;
    }
    if (etag) {
      h['If-None-Match'] = etag;
    }
    return h;
  }

  private async request(path: string): Promise<FetchResult> {
    const url = `${this.options.baseUrl}${path}`;
    const cached = this.etags.get(url);
    const res = await this.doFetch(url, { headers: this.headers(cached?.etag) });

    if (res.status === 304 && cached) {
      return { data: cached.data, etag: cached.etag };
    }
    if (res.status === 404) {
      throw new NotFoundError();
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0' || res.status === 429) {
        const reset = res.headers.get('x-ratelimit-reset');
        throw new RateLimitError(reset ? Number(reset) : undefined);
      }
    }
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}`);
    }

    const data = (await res.json()) as GitHubIssue;
    const etag = res.headers.get('etag') ?? undefined;
    if (etag) {
      this.etags.set(url, { etag, data });
    }
    return { data, etag };
  }

  private async write<T>(path: string, method: string, body: unknown): Promise<T> {
    const url = `${this.options.baseUrl}${path}`;
    const headers = this.headers();
    headers['Content-Type'] = 'application/json';
    const res = await this.doFetch(url, { method, headers, body: JSON.stringify(body) });

    if (res.status === 404) {
      throw new NotFoundError();
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0' || res.status === 429) {
        const reset = res.headers.get('x-ratelimit-reset');
        throw new RateLimitError(reset ? Number(reset) : undefined);
      }
    }
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Fetch an issue or PR by number. Issues and PRs share the /issues/{n}
   * namespace; a `pull_request` key marks a PR. When it is a PR, a second
   * request to /pulls/{n} enriches with merge/draft state.
   */
  async fetchIssueOrPr(owner: string, repo: string, number: string): Promise<FetchResult> {
    const issue = await this.request(`/repos/${owner}/${repo}/issues/${number}`);
    if (!issue.data.pull_request) {
      return issue;
    }
    try {
      const pr = await this.request(`/repos/${owner}/${repo}/pulls/${number}`);
      return pr;
    } catch {
      return issue;
    }
  }

  /** Open or close an issue/PR (state is shared via the /issues endpoint). */
  updateState(
    owner: string,
    repo: string,
    number: string,
    state: 'open' | 'closed',
  ): Promise<GitHubIssue> {
    return this.write(`/repos/${owner}/${repo}/issues/${number}`, 'PATCH', { state });
  }

  /** Replace the full set of labels on an issue/PR. */
  setLabels(owner: string, repo: string, number: string, labels: string[]): Promise<unknown> {
    return this.write(`/repos/${owner}/${repo}/issues/${number}/labels`, 'PUT', { labels });
  }

  /** Replace the full set of assignees on an issue/PR. */
  setAssignees(
    owner: string,
    repo: string,
    number: string,
    assignees: string[],
  ): Promise<GitHubIssue> {
    return this.write(`/repos/${owner}/${repo}/issues/${number}`, 'PATCH', { assignees });
  }

  /**
   * Whether the authenticated token can edit issues/PRs in the repo. GitHub
   * returns a `permissions` object on the repo only when authenticated; `push`
   * (or maintain/admin) is required to close/label/assign. Returns false when
   * unauthenticated or the field is absent.
   */
  async canPush(owner: string, repo: string): Promise<boolean> {
    if (!this.options.token) {
      return false;
    }
    try {
      const repoData = await this.getJson<{
        permissions?: { push?: boolean; maintain?: boolean; admin?: boolean };
      }>(`/repos/${owner}/${repo}`);
      const p = repoData.permissions;
      return Boolean(p?.push || p?.maintain || p?.admin);
    } catch {
      return false;
    }
  }

  async listRepoLabels(owner: string, repo: string): Promise<GitHubLabel[]> {
    return this.getJson<GitHubLabel[]>(`/repos/${owner}/${repo}/labels?per_page=100`);
  }

  async listAssignableUsers(owner: string, repo: string): Promise<GitHubUser[]> {
    return this.getJson<GitHubUser[]>(`/repos/${owner}/${repo}/assignees?per_page=100`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.doFetch(`${this.options.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (res.status === 404) {
      throw new NotFoundError();
    }
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}`);
    }
    return (await res.json()) as T;
  }

  clearEtags(): void {
    this.etags.clear();
  }
}
