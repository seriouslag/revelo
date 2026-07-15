import { Octokit } from '@octokit/rest';

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

interface OctokitError {
  status?: number;
  response?: { headers?: Record<string, string> };
}

export class GitHubClient {
  private readonly etags = new Map<string, CachedEtag>();
  private readonly octokit: Octokit;
  private readonly hasToken: boolean;

  constructor(options: GitHubClientOptions) {
    this.hasToken = Boolean(options.token);
    this.octokit = new Octokit({
      auth: options.token,
      baseUrl: options.baseUrl,
      request: options.fetchImpl ? { fetch: options.fetchImpl } : {},
    });
  }

  // Map Octokit RequestErrors onto our domain errors. 403/429 with an
  // exhausted rate-limit window becomes RateLimitError; 404 becomes NotFound.
  private fail(error: unknown): never {
    const err = error as OctokitError;
    const status = err.status;
    if (status === 404) {
      throw new NotFoundError();
    }
    if (status === 403 || status === 429) {
      const headers = err.response?.headers ?? {};
      const remaining = headers['x-ratelimit-remaining'];
      if (remaining === '0' || status === 429) {
        const reset = headers['x-ratelimit-reset'];
        throw new RateLimitError(reset ? Number(reset) : undefined);
      }
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  // Conditional GET with ETag caching. On 304 the cached body is reused; a
  // fresh 200 refreshes the cache. `cacheKey` distinguishes issue vs. PR reads.
  private async conditionalGet(
    cacheKey: string,
    route: string,
    params: Record<string, unknown>,
  ): Promise<FetchResult> {
    const cached = this.etags.get(cacheKey);
    try {
      const res = await this.octokit.request(route, {
        ...params,
        headers: cached ? { 'if-none-match': cached.etag } : undefined,
      });
      const data = res.data as unknown as GitHubIssue;
      const etag = (res.headers as Record<string, string>).etag;
      if (etag) {
        this.etags.set(cacheKey, { etag, data });
      }
      return { data, etag };
    } catch (error) {
      if ((error as OctokitError).status === 304 && cached) {
        return { data: cached.data, etag: cached.etag };
      }
      this.fail(error);
    }
  }

  /**
   * Fetch an issue or PR by number. Issues and PRs share the /issues/{n}
   * namespace; a `pull_request` key marks a PR. When it is a PR, a second
   * request to /pulls/{n} enriches with merge/draft state.
   */
  async fetchIssueOrPr(owner: string, repo: string, number: string): Promise<FetchResult> {
    const issue = await this.conditionalGet(
      `issue:${owner}/${repo}/${number}`,
      'GET /repos/{owner}/{repo}/issues/{issue_number}',
      { owner, repo, issue_number: Number(number) },
    );
    if (!issue.data.pull_request) {
      return issue;
    }
    try {
      return await this.conditionalGet(
        `pull:${owner}/${repo}/${number}`,
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        { owner, repo, pull_number: Number(number) },
      );
    } catch {
      return issue;
    }
  }

  /** Open or close an issue/PR (state is shared via the /issues endpoint). */
  async updateState(
    owner: string,
    repo: string,
    number: string,
    state: 'open' | 'closed',
  ): Promise<GitHubIssue> {
    try {
      const res = await this.octokit.request(
        'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
        { owner, repo, issue_number: Number(number), state },
      );
      return res.data as unknown as GitHubIssue;
    } catch (error) {
      this.fail(error);
    }
  }

  /** Replace the full set of labels on an issue/PR. */
  async setLabels(owner: string, repo: string, number: string, labels: string[]): Promise<unknown> {
    try {
      const res = await this.octokit.request(
        'PUT /repos/{owner}/{repo}/issues/{issue_number}/labels',
        { owner, repo, issue_number: Number(number), labels },
      );
      return res.data;
    } catch (error) {
      this.fail(error);
    }
  }

  /** Replace the full set of assignees on an issue/PR. */
  async setAssignees(
    owner: string,
    repo: string,
    number: string,
    assignees: string[],
  ): Promise<GitHubIssue> {
    try {
      const res = await this.octokit.request(
        'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
        { owner, repo, issue_number: Number(number), assignees },
      );
      return res.data as unknown as GitHubIssue;
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Whether the authenticated token can edit issues/PRs in the repo. GitHub
   * returns a `permissions` object on the repo only when authenticated; `push`
   * (or maintain/admin) is required to close/label/assign. Returns false when
   * unauthenticated or the field is absent.
   */
  async canPush(owner: string, repo: string): Promise<boolean> {
    if (!this.hasToken) {
      return false;
    }
    try {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
      const p = (res.data as { permissions?: { push?: boolean; maintain?: boolean; admin?: boolean } })
        .permissions;
      return Boolean(p?.push || p?.maintain || p?.admin);
    } catch {
      return false;
    }
  }

  async listRepoLabels(owner: string, repo: string): Promise<GitHubLabel[]> {
    try {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/labels', {
        owner,
        repo,
        per_page: 100,
      });
      return res.data as GitHubLabel[];
    } catch (error) {
      this.fail(error);
    }
  }

  async listAssignableUsers(owner: string, repo: string): Promise<GitHubUser[]> {
    try {
      const res = await this.octokit.request('GET /repos/{owner}/{repo}/assignees', {
        owner,
        repo,
        per_page: 100,
      });
      return res.data as GitHubUser[];
    } catch (error) {
      this.fail(error);
    }
  }

  clearEtags(): void {
    this.etags.clear();
  }
}
