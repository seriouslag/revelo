import { Version3Client } from 'jira.js';
import type { Version3Models } from 'jira.js';
import type { AxiosAdapter } from 'axios';
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

export interface JiraPriority {
  id: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
}

export interface JiraEpic {
  key: string;
  summary: string;
}

export interface CreateIssueFields {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: AdfNode;
  labels?: string[];
  priorityId?: string;
  dueDate?: string;
  parentKey?: string;
  assigneeAccountId?: string;
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
  // Injectable axios adapter for testing; production uses jira.js's default.
  adapter?: AxiosAdapter;
}

const ISSUE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'reporter',
  'priority',
  'issuetype',
  'description',
  'created',
  'updated',
  'labels',
];

// jira.js raises HttpException with a numeric `.status`; map onto our errors.
function mapError(error: unknown): never {
  const status = (error as { status?: number; response?: { status?: number } }).status
    ?? (error as { response?: { status?: number } }).response?.status;
  if (status === 401 || status === 403) {
    throw new JiraAuthError();
  }
  if (status === 404) {
    throw new JiraNotFoundError();
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export class JiraClient {
  private readonly client: Version3Client;

  constructor(options: JiraClientOptions) {
    this.client = new Version3Client({
      host: options.siteUrl.replace(/\/+$/, ''),
      authentication: { basic: { email: options.email, apiToken: options.token } },
      baseRequestConfig: options.adapter ? { adapter: options.adapter } : undefined,
    });
  }

  async fetchIssue(key: string): Promise<JiraIssue> {
    try {
      const issue = await this.client.issues.getIssue({ issueIdOrKey: key, fields: ISSUE_FIELDS });
      return issue as unknown as JiraIssue;
    } catch (error) {
      mapError(error);
    }
  }

  /**
   * Which edit permissions the current user has on an issue. Returns booleans
   * for EDIT_ISSUES, ASSIGN_ISSUES, TRANSITION_ISSUES so the panel can gate
   * each control independently.
   */
  async getMyPermissions(key: string): Promise<JiraPermissions> {
    try {
      const res = await this.client.permissions.getMyPermissions({
        issueKey: key,
        permissions: 'EDIT_ISSUES,ASSIGN_ISSUES,TRANSITION_ISSUES',
      });
      const p = (res.permissions ?? {}) as Record<string, { havePermission?: boolean }>;
      return {
        edit: Boolean(p.EDIT_ISSUES?.havePermission),
        assign: Boolean(p.ASSIGN_ISSUES?.havePermission),
        transition: Boolean(p.TRANSITION_ISSUES?.havePermission),
      };
    } catch (error) {
      mapError(error);
    }
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    try {
      const res = await this.client.issues.getTransitions({ issueIdOrKey: key });
      return (res.transitions ?? []) as JiraTransition[];
    } catch (error) {
      mapError(error);
    }
  }

  async doTransition(key: string, transitionId: string): Promise<void> {
    try {
      await this.client.issues.doTransition({ issueIdOrKey: key, transition: { id: transitionId } });
    } catch (error) {
      mapError(error);
    }
  }

  async getAssignableUsers(key: string, query: string): Promise<JiraAssignableUser[]> {
    try {
      const users = await this.client.userSearch.findAssignableUsers({
        issueKey: key,
        query,
        maxResults: 50,
      });
      return users as unknown as JiraAssignableUser[];
    } catch (error) {
      mapError(error);
    }
  }

  /** Assign to an accountId, or pass null to unassign. */
  async updateAssignee(key: string, accountId: string | null): Promise<void> {
    try {
      await this.client.issues.assignIssue({ issueIdOrKey: key, accountId });
    } catch (error) {
      mapError(error);
    }
  }

  async updateDescription(key: string, description: AdfNode): Promise<void> {
    try {
      await this.client.issues.editIssue({ issueIdOrKey: key, fields: { description } });
    } catch (error) {
      mapError(error);
    }
  }

  /** Create an issue; returns the new issue key (e.g. "ABC-123"). */
  async createIssue(input: CreateIssueFields): Promise<string> {
    try {
      const created = await this.client.issues.createIssue({
        fields: {
          project: { key: input.projectKey },
          issuetype: { name: input.issueType },
          summary: input.summary,
          // jira.js types description as its own Document shape; our AdfNode is
          // structurally compatible but has a looser `version`, so cast here.
          ...(input.description
            ? { description: input.description as unknown as Version3Models.Document }
            : {}),
          ...(input.labels && input.labels.length ? { labels: input.labels } : {}),
          ...(input.priorityId ? { priority: { id: input.priorityId } } : {}),
          ...(input.dueDate ? { duedate: input.dueDate } : {}),
          ...(input.parentKey ? { parent: { key: input.parentKey } } : {}),
          ...(input.assigneeAccountId
            ? { assignee: { id: input.assigneeAccountId } }
            : {}),
        },
      });
      return created.key;
    } catch (error) {
      mapError(error);
    }
  }

  /** Priorities available in this Jira instance. */
  async getPriorities(): Promise<JiraPriority[]> {
    try {
      const priorities = await this.client.issuePriorities.getPriorities();
      return (priorities as Array<{ id?: string; name?: string }>).map((p) => ({
        id: p.id ?? '',
        name: p.name ?? '',
      }));
    } catch (error) {
      mapError(error);
    }
  }

  /** Assignable users for a project (used before an issue exists). */
  async getAssignableUsersForProject(
    projectKey: string,
    query: string,
  ): Promise<JiraAssignableUser[]> {
    try {
      const users = await this.client.userSearch.findAssignableUsers({
        project: projectKey,
        query,
        maxResults: 50,
      });
      return users as unknown as JiraAssignableUser[];
    } catch (error) {
      mapError(error);
    }
  }

  /**
   * List a project's epics. Filtering by key/summary happens client-side (JQL
   * can't do partial-key matching, and the displayed label carries the key).
   */
  async searchEpics(projectKey: string): Promise<JiraEpic[]> {
    const jql = `project = "${projectKey}" AND issuetype = Epic ORDER BY created DESC`;
    try {
      // Uses the /search/jql endpoint; the older /search was removed by
      // Atlassian in 2025 and now returns 410 on Cloud.
      const res = await this.client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        maxResults: 100,
        fields: ['summary'],
      });
      const issues = (res.issues ?? []) as Array<{ key?: string; fields?: { summary?: string } }>;
      return issues.map((i) => ({ key: i.key ?? '', summary: i.fields?.summary ?? '' }));
    } catch (error) {
      mapError(error);
    }
  }

  /** Issue types defined in this Jira instance (instance-wide, deduped by name). */
  async getIssueTypes(): Promise<JiraIssueType[]> {
    try {
      const types = await this.client.issueTypes.getIssueAllTypes();
      const seen = new Set<string>();
      const result: JiraIssueType[] = [];
      // Subtasks can't be created standalone from a TODO; the instance-wide feed
      // also repeats a type once per project scheme, so dedupe by name.
      for (const t of types as Array<{ id?: string; name?: string; subtask?: boolean }>) {
        const name = t.name ?? '';
        if (!name || t.subtask || seen.has(name)) continue;
        seen.add(name);
        result.push({ id: t.id ?? '', name });
      }
      return result;
    } catch (error) {
      mapError(error);
    }
  }

  /** All labels defined in the instance (global; no server-side filter). */
  async getLabels(): Promise<string[]> {
    try {
      const res = await this.client.labels.getAllLabels({ maxResults: 1000 });
      return (res.values ?? []) as string[];
    } catch (error) {
      mapError(error);
    }
  }
}
