import * as vscode from 'vscode';
import type { EditAction, EditOption, ItemDetails, Provider, Reference } from '../../core/types';
import { ReferenceCache } from '../../core/cache';
import { escapeHtml, escapeMarkdown, formatDate, stateEmoji } from '../github/render';
import { JIRA_MATCHERS, parseJiraMatch, projectKeyOf, KEY_DENYLIST } from './matchers';
import {
  JiraClient,
  type JiraIssue,
  type JiraPermissions,
  type JiraPriority,
  type JiraIssueType,
  type JiraAssignableUser,
  type JiraEpic,
} from './api';

/** Prefetched, instance-wide options for the create-from-TODO form. */
export interface JiraCreateMeta {
  issueTypes: JiraIssueType[];
  priorities: JiraPriority[];
  labels: string[];
  epicsByProject: Record<string, JiraEpic[]>;
}
import { JiraAuth } from './auth';
import { adfToMarkdown, markdownToHtml, textToAdf, type AdfNode } from './adf';
import { actorName, deriveJiraState } from './render';

export class JiraProvider implements Provider {
  readonly id = 'jira' as const;
  readonly displayName = 'Jira';
  readonly matchers = JIRA_MATCHERS;
  readonly auth: JiraAuth;

  private readonly cache: ReferenceCache<ItemDetails>;
  private createMeta?: { at: number; value: Promise<JiraCreateMeta> };

  constructor(secrets: vscode.SecretStorage) {
    this.auth = new JiraAuth(secrets);
    const ttlMs = this.ttlSeconds() * 1000;
    this.cache = new ReferenceCache<ItemDetails>({ ttlMs, negativeTtlMs: 30_000 });
  }

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration('revelo.jira').get('enabled', false);
  }

  clearCache(): void {
    this.cache.clear();
    this.createMeta = undefined;
  }

  private ttlSeconds(): number {
    return vscode.workspace.getConfiguration('revelo.cache').get('ttlSeconds', 300);
  }

  private configuredKeys(): string[] {
    return vscode.workspace
      .getConfiguration('revelo.jira')
      .get<string[]>('projectKeys', [])
      .map((k) => k.toUpperCase());
  }

  parse(match: RegExpMatchArray): Omit<Reference, 'range'> | null {
    const kind = (match as RegExpMatchArray & { kind?: string }).kind ?? this.inferKind(match);
    const parsed = parseJiraMatch(kind, match);
    if (!parsed) {
      return null;
    }

    if (parsed.kind === 'issue') {
      return {
        providerId: 'jira',
        kind: 'issue',
        raw: match[0],
        key: `jira:${parsed.site}/${parsed.key}`,
        fields: { site: parsed.site, issueKey: parsed.key },
      };
    }

    // Bare key (or server URL): reject denylisted prefixes, and if the user has
    // configured an explicit allowlist, require membership.
    const projectKey = projectKeyOf(parsed.key);
    if (KEY_DENYLIST.has(projectKey)) {
      return null;
    }
    const allow = this.configuredKeys();
    if (allow.length > 0 && !allow.includes(projectKey)) {
      return null;
    }
    return {
      providerId: 'jira',
      kind: 'issue',
      raw: match[0],
      key: `jira:${parsed.key}`,
      fields: { issueKey: parsed.key },
    };
  }

  private inferKind(match: RegExpMatchArray): string {
    if (/atlassian\.net\/browse\//.test(match[0])) return 'cloud-url';
    if (/^https?:/.test(match[0])) return 'server-url';
    return 'key';
  }

  private async buildClient(ref: Reference): Promise<{ client: JiraClient; siteUrl: string }> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new Error('No Jira token configured — run "Revelo: Set Jira Token"');
    }
    const email = this.auth.email();
    if (!email) {
      throw new Error('Jira email not configured (revelo.jira.email)');
    }
    const siteUrl = this.auth.baseUrl(ref);
    if (!siteUrl) {
      throw new Error('Jira site not configured (revelo.jira.siteUrl)');
    }
    return { client: new JiraClient({ siteUrl, email, token }), siteUrl };
  }

  async fetch(ref: Reference, _token: vscode.CancellationToken): Promise<ItemDetails> {
    return this.cache.resolve(ref.key, async () => {
      const { client, siteUrl } = await this.buildClient(ref);
      const [issue, perms] = await Promise.all([
        client.fetchIssue(ref.fields.issueKey),
        // Permission check is best-effort; if it fails, controls stay hidden.
        client.getMyPermissions(ref.fields.issueKey).catch(() => ({
          edit: false,
          assign: false,
          transition: false,
        })),
      ]);
      return this.toDetails(ref, issue, siteUrl, perms);
    });
  }

  readonly editable = {
    canEdit: (_ref?: Reference): boolean => this.isEnabled(),

    getOptions: async (
      ref: Reference,
      kind: 'transition' | 'assignee',
      query: string,
    ): Promise<EditOption[]> => {
      const { client } = await this.buildClient(ref);
      const key = ref.fields.issueKey;
      if (kind === 'transition') {
        const transitions = await client.getTransitions(key);
        return transitions.map((t) => ({ id: t.id, label: t.to?.name ?? t.name }));
      }
      const users = await client.getAssignableUsers(key, query);
      return users.map((u) => ({
        id: u.accountId,
        label: u.emailAddress ? `${u.displayName} (${u.emailAddress})` : u.displayName,
      }));
    },

    applyEdit: async (ref: Reference, action: EditAction): Promise<void> => {
      const { client } = await this.buildClient(ref);
      const key = ref.fields.issueKey;
      switch (action.type) {
        case 'transition':
          await client.doTransition(key, action.transitionId);
          return;
        case 'assign':
          await client.updateAssignee(key, action.accountId);
          return;
        case 'description':
          await client.updateDescription(key, textToAdf(action.text));
          return;
      }
    },
  };

  /** Build a bare-key reference (no range) for a known issue key. */
  refForKey(issueKey: string): Omit<Reference, 'range'> {
    return {
      providerId: 'jira',
      kind: 'issue',
      raw: issueKey,
      key: `jira:${issueKey}`,
      fields: { issueKey },
    };
  }

  /** Browser URL for an issue key, using the configured site. */
  issueUrl(issueKey: string): string {
    const siteUrl = vscode.workspace
      .getConfiguration('revelo.jira')
      .get<string>('siteUrl', '')
      .replace(/\/+$/, '');
    return `${siteUrl}/browse/${issueKey}`;
  }

  /** Build a client from config (no reference), for create-form operations. */
  private async configClient(): Promise<JiraClient> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new Error('No Jira token configured — run "Revelo: Set Jira Token"');
    }
    const email = this.auth.email();
    if (!email) {
      throw new Error('Jira email not configured (revelo.jira.email)');
    }
    const siteUrl = vscode.workspace
      .getConfiguration('revelo.jira')
      .get<string>('siteUrl', '')
      .replace(/\/+$/, '');
    if (!siteUrl) {
      throw new Error('Jira site not configured (revelo.jira.siteUrl)');
    }
    return new JiraClient({ siteUrl, email, token });
  }

  /**
   * Create a Jira issue from config (no reference). Resolves the site from
   * revelo.jira.siteUrl. Returns the new issue key.
   */
  async createIssue(input: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    labels?: string[];
    priorityId?: string;
    dueDate?: string;
    parentKey?: string;
    assigneeAccountId?: string;
  }): Promise<string> {
    const client = await this.configClient();
    return client.createIssue({
      projectKey: input.projectKey,
      issueType: input.issueType,
      summary: input.summary,
      description: input.description ? textToAdf(input.description) : undefined,
      labels: input.labels,
      priorityId: input.priorityId,
      dueDate: input.dueDate,
      parentKey: input.parentKey,
      assigneeAccountId: input.assigneeAccountId,
    });
  }

  async getAssignableUsersForProject(
    projectKey: string,
    query: string,
  ): Promise<JiraAssignableUser[]> {
    return (await this.configClient()).getAssignableUsersForProject(projectKey, query);
  }

  async searchEpics(projectKey: string): Promise<JiraEpic[]> {
    return (await this.configClient()).searchEpics(projectKey);
  }

  private prefetchEpicsMaxProjects(): number {
    return vscode.workspace
      .getConfiguration('revelo.jira')
      .get<number>('prefetchEpicsMaxProjects', 5);
  }

  /**
   * Instance-wide options for the create form (issue types, priorities, labels)
   * plus epics for the configured projects. Cached for the configured TTL and
   * shared across opens. Throws if Jira can't be reached — the caller surfaces
   * that as an error rather than rendering a form with empty dropdowns.
   */
  async getCreateMeta(): Promise<JiraCreateMeta> {
    const fresh =
      this.createMeta && Date.now() - this.createMeta.at < this.ttlSeconds() * 1000;
    if (this.createMeta && fresh) {
      return this.createMeta.value;
    }
    const value = this.fetchCreateMeta();
    this.createMeta = { at: Date.now(), value };
    // Don't cache a rejection: a transient failure shouldn't poison later opens.
    value.catch(() => {
      this.createMeta = undefined;
    });
    return value;
  }

  /** Warm the create-meta cache; best-effort (no token yet is not an error). */
  async prefetchCreateMeta(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.getCreateMeta();
    } catch {
      // Ignore — surfaced later when the user actually opens the create form.
    }
  }

  private async fetchCreateMeta(): Promise<JiraCreateMeta> {
    const client = await this.configClient();
    const [issueTypes, priorities, labels] = await Promise.all([
      client.getIssueTypes(),
      client.getPriorities(),
      client.getLabels(),
    ]);
    const epicsByProject: Record<string, JiraEpic[]> = {};
    const max = this.prefetchEpicsMaxProjects();
    const keys = this.configuredKeys();
    if (max > 0 && keys.length > 0 && keys.length <= max) {
      const lists = await Promise.all(keys.map((k) => client.searchEpics(k).catch(() => [])));
      keys.forEach((k, i) => {
        epicsByProject[k] = lists[i];
      });
    }
    return { issueTypes, priorities, labels, epicsByProject };
  }

  private toDetails(
    ref: Reference,
    issue: JiraIssue,
    siteUrl: string,
    perms: JiraPermissions,
  ): ItemDetails {
    const f = issue.fields;
    const description = f.description;
    const descMarkdown =
      typeof description === 'string' ? description : adfToMarkdown(description as AdfNode);

    return {
      ref,
      title: f.summary ?? issue.key,
      url: `${siteUrl}/browse/${issue.key}`,
      fetchedAt: Date.now(),
      state: deriveJiraState(issue),
      meta: {
        key: issue.key,
        type: f.issuetype?.name ?? '',
        priority: f.priority?.name ?? '',
        assignee: actorName(f.assignee),
        reporter: actorName(f.reporter),
        labels: f.labels ?? [],
        created: f.created ?? '',
        updated: f.updated ?? '',
        descMarkdown,
        canTransition: perms.transition,
        canAssign: perms.assign,
        canEditFields: perms.edit,
      },
    };
  }

  renderHover(item: ItemDetails): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${item.state.label}` : '';
    const key = String(m.key ?? '');
    const type = String(m.type ?? '');

    md.appendMarkdown(`#### ${escapeMarkdown(item.title)}\n\n`);

    const metaParts = [badge, `\`${key}\``];
    if (type) {
      metaParts.push(type);
    }
    const priority = String(m.priority ?? '');
    if (priority) {
      metaParts.push(priority);
    }
    md.appendMarkdown(`${metaParts.join(' &nbsp;·&nbsp; ')}\n\n`);

    const assignee = String(m.assignee ?? '');
    if (assignee) {
      md.appendMarkdown(`Assignee: ${escapeMarkdown(assignee)}\n\n`);
    }

    const snippet = truncate(String(m.descMarkdown ?? ''), 280);
    if (snippet) {
      // Description is already Markdown (from ADF) — render it, don't escape.
      md.appendMarkdown(`---\n\n${snippet}\n\n`);
    }

    const args = encodeURIComponent(JSON.stringify([item.ref.key]));
    md.appendMarkdown(
      `$(book) [Open Details](command:revelo.openPanel?${args}) &nbsp;·&nbsp; $(link-external) [Open in Jira](${item.url})`,
    );
    md.isTrusted = { enabledCommands: ['revelo.openPanel'] };
    return md;
  }

  renderPanel(item: ItemDetails): string {
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${escapeHtml(item.state.label)}` : '';
    const key = escapeHtml(String(m.key ?? ''));
    const type = escapeHtml(String(m.type ?? ''));
    const priority = escapeHtml(String(m.priority ?? ''));
    const assignee = escapeHtml(String(m.assignee ?? ''));
    const reporter = escapeHtml(String(m.reporter ?? ''));
    const created = formatDate(String(m.created ?? ''));
    const updated = formatDate(String(m.updated ?? ''));
    const labels = ((m.labels as string[]) ?? [])
      .map((l) => `<span class="label">${escapeHtml(l)}</span>`)
      .join('');
    const descMarkdown = String(m.descMarkdown ?? '');
    const descHtml = markdownToHtml(descMarkdown);
    const enabled = this.editable.canEdit();
    // Per-control gating from Jira /mypermissions.
    const canTransition = enabled && Boolean(m.canTransition);
    const canAssign = enabled && Boolean(m.canAssign);
    const canEditFields = enabled && Boolean(m.canEditFields);
    const currentStatus = escapeHtml(item.state?.label ?? '');
    const currentAssignee = escapeHtml(String(m.assignee ?? ''));

    const statusControl = canTransition
      ? `
<div class="edit-row">
  <label>Status</label>
  <select data-edit="transition">
    <option value="" selected>${currentStatus || 'Change status…'}</option>
  </select>
  <span class="status-msg" data-status-for="transition"></span>
</div>`
      : '';
    const assigneeControl = canAssign
      ? `
<div class="edit-row">
  <label>Assignee</label>
  <div class="combobox">
    <input type="text" data-edit="assignee" data-assign-mode="single" placeholder="Search users…"
           value="${currentAssignee}" autocomplete="off" spellcheck="false" />
    <ul class="combobox-list" data-combobox-list hidden></ul>
  </div>
  <span class="status-msg" data-status-for="assignee"></span>
</div>`
      : '';
    const editControls = `${statusControl}${assigneeControl}`;

    const descriptionSection = canEditFields
      ? `
<div class="edit-body">
  <label>Description</label>
  <textarea data-edit="description">${escapeHtml(descMarkdown)}</textarea>
  <div class="edit-row">
    <button data-action="save-description">Save description</button>
    <span class="status-msg" data-status-for="description"></span>
  </div>
</div>`
      : `<div class="body">${descHtml || '<em class="meta">No description.</em>'}</div>`;

    return `
<div class="header">
  <span class="badge badge-${item.state?.kind ?? 'unknown'}">${badge}</span>
  <span class="slug">${key}${type ? ` · ${type}` : ''}</span>
</div>
<h1><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h1>
<p class="meta">${priority ? `priority: ${priority} · ` : ''}${assignee ? `assignee: ${assignee} · ` : ''}${reporter ? `reporter: ${reporter}` : ''}</p>
<p class="meta">${created ? `created ${escapeHtml(created)}` : ''}${created && updated ? ' · ' : ''}${updated ? `updated ${escapeHtml(updated)}` : ''}</p>
${labels ? `<p class="labels">${labels}</p>` : ''}
${editControls}
${descriptionSection}`;
  }
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\n{2,}/g, '\n');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}
