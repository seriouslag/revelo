import * as vscode from 'vscode';
import type { EditAction, EditOption, ItemDetails, Provider, Reference } from '../../core/types';
import { ReferenceCache } from '../../core/cache';
import { getWorkspaceRemote } from '../../core/workspaceGit';
import { GITHUB_MATCHERS, parseMatch } from './matchers';
import { GitHubClient, type GitHubIssue } from './api';
import { GitHubAuth } from './auth';
import {
  authorUrl,
  cleanBody,
  deriveState,
  escapeHtml,
  escapeMarkdown,
  formatDate,
  labelNames,
  stateEmoji,
} from './render';

interface RepoTarget {
  host: string;
  owner: string;
  repo: string;
  number: string;
}

export class GitHubProvider implements Provider {
  readonly id = 'github' as const;
  readonly displayName = 'GitHub';
  readonly matchers = GITHUB_MATCHERS;
  readonly auth: GitHubAuth;

  private readonly cache: ReferenceCache<ItemDetails>;

  constructor(secrets: vscode.SecretStorage) {
    this.auth = new GitHubAuth(secrets);
    const ttlMs = this.ttlSeconds() * 1000;
    this.cache = new ReferenceCache<ItemDetails>({ ttlMs, negativeTtlMs: 30_000 });
  }

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration('revelo.github').get('enabled', true);
  }

  clearCache(): void {
    this.cache.clear();
    this.pushPerms.clear();
  }

  private ttlSeconds(): number {
    return vscode.workspace.getConfiguration('revelo.cache').get('ttlSeconds', 300);
  }

  parse(match: RegExpMatchArray): Omit<Reference, 'range'> | null {
    const kind = (match as RegExpMatchArray & { kind?: string }).kind;
    const parsed = parseMatch(kind ?? this.inferKind(match), match);
    if (!parsed) {
      return null;
    }
    if (parsed.kind === 'bare') {
      return {
        providerId: 'github',
        kind: 'bare',
        raw: match[0],
        key: `github:bare#${parsed.number}`,
        fields: { number: parsed.number },
      };
    }
    return {
      providerId: 'github',
      kind: parsed.kind,
      raw: match[0],
      key: `github:${parsed.host}/${parsed.owner}/${parsed.repo}#${parsed.number}`,
      fields: { ...parsed, comment: parsed.comment ?? '' },
    };
  }

  // The scanner does not tag matches with their matcher kind, so infer it from
  // the shape of match[0].
  private inferKind(match: RegExpMatchArray): string {
    const raw = match[0];
    if (/^https?:/.test(raw)) return 'url';
    if (raw.includes('/')) return 'cross-repo';
    return 'bare';
  }

  private async resolveTarget(ref: Reference): Promise<RepoTarget | undefined> {
    const f = ref.fields;
    if (f.owner && f.repo && f.number) {
      return { host: f.host ?? 'github.com', owner: f.owner, repo: f.repo, number: f.number };
    }
    if (ref.kind === 'bare' && f.number) {
      const target = await this.resolveBareRepo();
      if (target) {
        return { ...target, number: f.number };
      }
    }
    return undefined;
  }

  private async resolveBareRepo(): Promise<Omit<RepoTarget, 'number'> | undefined> {
    const configured = vscode.workspace
      .getConfiguration('revelo.github')
      .get<string>('defaultRepo', '');
    if (configured && configured.includes('/')) {
      const [owner, repo] = configured.split('/');
      return { host: 'github.com', owner, repo };
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme === 'file') {
      const remote = await getWorkspaceRemote(folder.uri.fsPath);
      if (remote) {
        return remote;
      }
    }
    return undefined;
  }

  private async buildClient(ref: Reference): Promise<{ client: GitHubClient; target: RepoTarget }> {
    const target = await this.resolveTarget(ref);
    if (!target) {
      throw new Error('Unresolved reference');
    }
    const token = await this.auth.getToken();
    const client = new GitHubClient({ baseUrl: this.auth.baseUrl(ref), token });
    return { client, target };
  }

  // Cached per-repo push permission for the current token, so we don't refetch
  // the repo for every issue in the same repo. Keyed "host/owner/repo".
  private readonly pushPerms = new Map<string, Promise<boolean>>();

  private canPushTo(client: GitHubClient, target: RepoTarget): Promise<boolean> {
    const key = `${target.host}/${target.owner}/${target.repo}`;
    let cached = this.pushPerms.get(key);
    if (!cached) {
      cached = client.canPush(target.owner, target.repo);
      this.pushPerms.set(key, cached);
    }
    return cached;
  }

  async fetch(ref: Reference, _token: vscode.CancellationToken): Promise<ItemDetails> {
    return this.cache.resolve(ref.key, async () => {
      const { client, target } = await this.buildClient(ref);
      const [{ data }, canPush] = await Promise.all([
        client.fetchIssueOrPr(target.owner, target.repo, target.number),
        this.canPushTo(client, target),
      ]);
      return this.toDetails(ref, target, data, canPush);
    });
  }

  private toDetails(
    ref: Reference,
    target: RepoTarget,
    data: GitHubIssue,
    canPush: boolean,
  ): ItemDetails {
    const isPr =
      Boolean(data.pull_request) || data.merged !== undefined || data.draft !== undefined;
    return {
      ref,
      title: data.title,
      url: data.html_url,
      fetchedAt: Date.now(),
      state: deriveState(data),
      meta: {
        repo: `${target.owner}/${target.repo}`,
        number: target.number,
        author: data.user?.login ?? '',
        labels: labelNames(data),
        assignees: (data.assignees ?? []).map((a) => a.login),
        comments: data.comments ?? 0,
        body: data.body ?? '',
        created: data.created_at ?? '',
        updated: data.updated_at ?? '',
        authorUrl: data.user ? authorUrl(data.html_url, data.user.login) : '',
        isPr,
        rawState: data.state,
        merged: Boolean(data.merged || data.pull_request?.merged_at),
        canPush,
      },
    };
  }

  readonly editable = {
    // Config gate only; per-repo push permission is stored in meta.canPush and
    // enforced when rendering the panel controls.
    canEdit: (): boolean => this.isEnabled(),

    getOptions: async (
      ref: Reference,
      kind: 'transition' | 'assignee' | 'label',
      _query: string,
    ): Promise<EditOption[]> => {
      const { client, target } = await this.buildClient(ref);
      if (kind === 'assignee') {
        const users = await client.listAssignableUsers(target.owner, target.repo);
        return users.map((u) => ({ id: u.login, label: u.login }));
      }
      if (kind === 'label') {
        const labels = await client.listRepoLabels(target.owner, target.repo);
        return labels.map((l) => ({ id: l.name, label: l.name }));
      }
      return [];
    },

    applyEdit: async (ref: Reference, action: EditAction): Promise<void> => {
      const { client, target } = await this.buildClient(ref);
      const { owner, repo, number } = target;
      switch (action.type) {
        case 'state':
          await client.updateState(owner, repo, number, action.state);
          return;
        case 'labels':
          await client.setLabels(owner, repo, number, action.labels);
          return;
        case 'assignees':
          await client.setAssignees(owner, repo, number, action.logins);
          return;
        default:
          throw new Error(`Unsupported GitHub edit: ${action.type}`);
      }
    },
  };

  renderHover(item: ItemDetails): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${item.state.label}` : '';
    // Text inside a backtick code span is not parsed as markdown, so it must
    // NOT be markdown-escaped — otherwise "#" renders as "\#".
    const slug = `${String(m.repo ?? '')}#${String(m.number ?? '')}`;
    const author = String(m.author ?? '');

    // Title as a linked heading.
    md.appendMarkdown(`#### [${escapeMarkdown(item.title)}](${item.url})\n\n`);

    // Meta line: state badge · slug · author · opened date.
    const metaParts = [badge, `\`${slug}\``];
    if (author) {
      const url = String(m.authorUrl ?? '');
      metaParts.push(url ? `by [${escapeMarkdown(author)}](${url})` : `by \`${author}\``);
    }
    const created = formatDate(String(m.created ?? ''));
    if (created) {
      metaParts.push(`opened ${created}`);
    }
    md.appendMarkdown(`${metaParts.join(' &nbsp;·&nbsp; ')}\n\n`);

    const labels = (m.labels as string[]) ?? [];
    if (labels.length > 0) {
      md.appendMarkdown(`${labels.map((l) => `\`${l}\``).join(' ')}\n\n`);
    }

    const body = cleanBody(String(m.body ?? ''));
    if (body) {
      md.appendMarkdown(`---\n\n${escapeMarkdown(body)}\n\n`);
    }

    const args = encodeURIComponent(JSON.stringify([item.ref.key]));
    md.appendMarkdown(
      `$(book) [Open Details](command:revelo.openPanel?${args}) &nbsp;·&nbsp; $(github) [View on GitHub](${item.url})`,
    );
    md.isTrusted = { enabledCommands: ['revelo.openPanel'] };
    return md;
  }

  renderPanel(item: ItemDetails): string {
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${escapeHtml(item.state.label)}` : '';
    const repo = escapeHtml(String(m.repo ?? ''));
    const number = escapeHtml(String(m.number ?? ''));
    const labels = ((m.labels as string[]) ?? [])
      .map((l) => `<span class="label">${escapeHtml(l)}</span>`)
      .join('');
    const assignees = ((m.assignees as string[]) ?? []).map(escapeHtml).join(', ');
    const created = formatDate(String(m.created ?? ''));
    const author = String(m.author ?? '');
    const authorHref = String(m.authorUrl ?? '');
    const authorHtml = authorHref
      ? `<a href="${escapeHtml(authorHref)}"><strong>${escapeHtml(author)}</strong></a>`
      : `<strong>${escapeHtml(author)}</strong>`;
    const body = escapeHtml(cleanBody(String(m.body ?? ''), 4000));
    // Show edit controls only when the extension is enabled AND the token has
    // push access to this specific repo (checked per-repo in fetch()).
    const canEdit = this.editable.canEdit() && Boolean(m.canPush);
    const isPr = Boolean(m.isPr);
    const merged = Boolean(m.merged);
    const rawState = String(m.rawState ?? 'open');
    const noun = isPr ? 'PR' : 'issue';

    // Merged PRs cannot be reopened/closed via the issues state field.
    const stateControl =
      canEdit && !merged
        ? `
<div class="edit-row">
  <label>State</label>
  <button data-action="toggle-state" data-state="${rawState}" data-noun="${noun}">
    ${rawState === 'open' ? `Close ${noun}` : `Reopen ${noun}`}
  </button>
  <span class="status-msg" data-status-for="state"></span>
</div>`
        : '';

    const currentAssignee = escapeHtml(((m.assignees as string[]) ?? [])[0] ?? '');
    const assigneeControl = canEdit
      ? `
<div class="edit-row">
  <label>Assignee</label>
  <div class="combobox">
    <input type="text" data-edit="assignee" data-assign-mode="list" placeholder="Search users…"
           value="${currentAssignee}" autocomplete="off" spellcheck="false" />
    <ul class="combobox-list" data-combobox-list hidden></ul>
  </div>
  <span class="status-msg" data-status-for="assignee"></span>
</div>`
      : '';

    const currentLabels = JSON.stringify(((m.labels as string[]) ?? []));
    const labelControl = canEdit
      ? `
<div class="edit-row">
  <label>Labels</label>
  <button data-action="edit-labels" data-current='${escapeHtml(currentLabels)}'>Edit labels…</button>
  <span class="status-msg" data-status-for="labels"></span>
</div>
<div class="label-editor" data-label-editor hidden></div>`
      : '';

    const editControls = canEdit ? `${stateControl}${assigneeControl}${labelControl}` : '';

    return `
<div class="header">
  <span class="badge badge-${item.state?.kind ?? 'unknown'}">${badge}</span>
  <span class="slug">${repo}#${number}</span>
</div>
<h1><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h1>
<p class="meta">by ${authorHtml}${created ? ` · opened ${escapeHtml(created)}` : ''}${assignees ? ` · assigned to ${assignees}` : ''} · ${escapeHtml(String(m.comments ?? 0))} comments</p>
${labels ? `<p class="labels">${labels}</p>` : ''}
${editControls}
<div class="body">${body || '<em class="meta">No description provided.</em>'}</div>`;
  }
}
