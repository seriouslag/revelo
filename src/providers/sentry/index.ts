import * as vscode from 'vscode';
import type { EditAction, EditOption, ItemDetails, Provider, Reference } from '../../core/types';
import { ReferenceCache } from '../../core/cache';
import { escapeHtml, escapeMarkdown, formatDate, stateEmoji } from '../github/render';
import { SENTRY_MATCHERS, parseSentryMatch, orgFromHost, shortIdPrefix } from './matchers';
import { SentryClient, type SentryIssue } from './api';
import { SentryAuth } from './auth';
import { assigneeName, deriveSentryState, formatCount, levelEmoji } from './render';

// Short IDs collide with ordinary hyphenated words and Jira keys, so a candidate
// is only treated as a Sentry short id when its project prefix is on this list.
function configuredProjectPrefixes(): string[] {
  return vscode.workspace
    .getConfiguration('revelo.sentry')
    .get<string[]>('shortIdPrefixes', [])
    .map((p) => p.toUpperCase());
}

export class SentryProvider implements Provider {
  readonly id = 'sentry' as const;
  readonly displayName = 'Sentry';
  readonly matchers = SENTRY_MATCHERS;
  readonly auth: SentryAuth;

  private readonly cache: ReferenceCache<ItemDetails>;

  constructor(secrets: vscode.SecretStorage) {
    this.auth = new SentryAuth(secrets);
    const ttlMs = this.ttlSeconds() * 1000;
    this.cache = new ReferenceCache<ItemDetails>({ ttlMs, negativeTtlMs: 30_000 });
  }

  isEnabled(): boolean {
    return vscode.workspace.getConfiguration('revelo.sentry').get('enabled', false);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private ttlSeconds(): number {
    return vscode.workspace.getConfiguration('revelo.cache').get('ttlSeconds', 300);
  }

  private orgSlug(): string {
    return vscode.workspace.getConfiguration('revelo.sentry').get<string>('orgSlug', '');
  }

  parse(match: RegExpMatchArray): Omit<Reference, 'range'> | null {
    const kind = (match as RegExpMatchArray & { kind?: string }).kind ?? this.inferKind(match);
    const parsed = parseSentryMatch(kind, match);
    if (!parsed) {
      return null;
    }

    if (parsed.kind === 'issue') {
      return {
        providerId: 'sentry',
        kind: 'issue',
        raw: match[0],
        key: `sentry:${parsed.host}/${parsed.orgSlug}/issues/${parsed.issueId}`,
        fields: {
          host: parsed.host,
          orgSlug: parsed.orgSlug,
          issueId: parsed.issueId,
          eventId: parsed.eventId ?? '',
        },
      };
    }

    // short-id: only accept when the project prefix is configured.
    if (!configuredProjectPrefixes().includes(shortIdPrefix(parsed.shortId))) {
      return null;
    }
    return {
      providerId: 'sentry',
      kind: 'short-id',
      raw: match[0],
      key: `sentry:shortid/${parsed.shortId}`,
      fields: { shortId: parsed.shortId },
    };
  }

  private inferKind(match: RegExpMatchArray): string {
    return /^https?:/.test(match[0]) ? 'issue-url' : 'short-id';
  }

  private async buildClient(ref: Reference): Promise<SentryClient> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new Error('No Sentry token configured — run "Revelo: Set Sentry Token"');
    }
    return new SentryClient({ baseUrl: this.auth.baseUrl(ref), token });
  }

  /** Resolve a reference to its concrete org slug + numeric issue id. */
  private async resolveTarget(
    client: SentryClient,
    ref: Reference,
  ): Promise<{ org: string; issueId: string; issue?: SentryIssue }> {
    if (ref.kind === 'short-id') {
      const org = this.orgSlug();
      if (!org) {
        throw new Error('Sentry orgSlug not configured');
      }
      const resolution = await client.resolveShortId(org, ref.fields.shortId);
      return {
        org: resolution.organizationSlug,
        issueId: resolution.group.id,
        issue: resolution.group,
      };
    }
    const org = ref.fields.orgSlug || orgFromHost(ref.fields.host ?? '') || this.orgSlug();
    if (!org) {
      throw new Error('Could not determine Sentry org');
    }
    return { org, issueId: ref.fields.issueId };
  }

  async fetch(ref: Reference, _token: vscode.CancellationToken): Promise<ItemDetails> {
    return this.cache.resolve(ref.key, async () => {
      const client = await this.buildClient(ref);
      const target = await this.resolveTarget(client, ref);
      const issue = target.issue ?? (await client.fetchIssue(target.org, target.issueId));
      return this.toDetails(ref, issue, target.org, target.issueId);
    });
  }

  private toDetails(
    ref: Reference,
    issue: SentryIssue,
    org: string,
    issueId: string,
  ): ItemDetails {
    const url = issue.permalink ?? '';
    return {
      ref,
      title: issue.title,
      url,
      fetchedAt: Date.now(),
      state: deriveSentryState(issue),
      meta: {
        shortId: issue.shortId ?? '',
        org,
        issueId,
        project: issue.project?.slug ?? issue.project?.name ?? '',
        level: issue.level ?? '',
        culprit: issue.culprit ?? '',
        count: formatCount(issue.count),
        userCount: issue.userCount ?? 0,
        firstSeen: issue.firstSeen ?? '',
        lastSeen: issue.lastSeen ?? '',
        assignee: assigneeName(issue),
        status: issue.status ?? '',
      },
    };
  }

  readonly editable = {
    // Sentry permissions are token-scope based (event:write), and Sentry has no
    // cheap per-issue permission check. Editing is therefore opt-in: the user
    // asserts their token has write scope via the enableEditing setting.
    canEdit: (): boolean =>
      this.isEnabled() &&
      vscode.workspace.getConfiguration('revelo.sentry').get('enableEditing', false),

    getOptions: async (): Promise<EditOption[]> => {
      // Sentry status options are fixed; assignee search is not wired for v1.
      return [];
    },

    applyEdit: async (ref: Reference, action: EditAction): Promise<void> => {
      if (action.type !== 'sentryStatus') {
        throw new Error(`Unsupported Sentry edit: ${action.type}`);
      }
      const client = await this.buildClient(ref);
      const target = await this.resolveTarget(client, ref);
      await client.updateStatus(target.org, target.issueId, action.status);
    },
  };

  renderHover(item: ItemDetails): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${item.state.label}` : '';
    const level = levelEmoji(String(m.level ?? ''));
    const shortId = String(m.shortId ?? '');

    md.appendMarkdown(`#### ${level ? `${level} ` : ''}${escapeMarkdown(item.title)}\n\n`);

    const metaParts = [badge];
    if (shortId) {
      metaParts.push(`\`${shortId}\``);
    }
    const project = String(m.project ?? '');
    if (project) {
      metaParts.push(`in \`${project}\``);
    }
    md.appendMarkdown(`${metaParts.join(' &nbsp;·&nbsp; ')}\n\n`);

    const culprit = String(m.culprit ?? '');
    if (culprit) {
      md.appendMarkdown(`\`${escapeMarkdown(culprit)}\`\n\n`);
    }

    md.appendMarkdown(
      `${escapeMarkdown(String(m.count ?? '0'))} events &nbsp;·&nbsp; ${escapeMarkdown(String(m.userCount ?? 0))} users\n\n`,
    );

    const lastSeen = formatDate(String(m.lastSeen ?? ''));
    if (lastSeen) {
      md.appendMarkdown(`Last seen ${lastSeen}\n\n`);
    }

    const args = encodeURIComponent(JSON.stringify([item.ref.key]));
    md.appendMarkdown(`$(book) [Open Details](command:revelo.openPanel?${args})`);
    if (item.url) {
      md.appendMarkdown(` &nbsp;·&nbsp; $(link-external) [View in Sentry](${item.url})`);
    }
    md.isTrusted = { enabledCommands: ['revelo.openPanel'] };
    return md;
  }

  renderPanel(item: ItemDetails): string {
    const m = item.meta as Record<string, unknown>;
    const badge = item.state ? `${stateEmoji(item.state.kind)} ${escapeHtml(item.state.label)}` : '';
    const shortId = escapeHtml(String(m.shortId ?? ''));
    const project = escapeHtml(String(m.project ?? ''));
    const culprit = escapeHtml(String(m.culprit ?? ''));
    const firstSeen = formatDate(String(m.firstSeen ?? ''));
    const lastSeen = formatDate(String(m.lastSeen ?? ''));
    const assignee = escapeHtml(String(m.assignee ?? ''));
    const level = escapeHtml(String(m.level ?? ''));
    const canEdit = this.editable.canEdit();
    const currentStatus = String(m.status ?? 'unresolved');
    const statusOption = (value: string, label: string): string =>
      `<option value="${value}"${value === currentStatus ? ' selected' : ''}>${label}</option>`;

    const statusControl = canEdit
      ? `
<div class="edit-row">
  <label>Status</label>
  <select data-edit="sentry-status">
    ${statusOption('unresolved', 'Unresolved')}
    ${statusOption('resolved', 'Resolved')}
    ${statusOption('ignored', 'Ignored')}
  </select>
  <span class="status-msg" data-status-for="sentry-status"></span>
</div>`
      : '';

    return `
<div class="header">
  <span class="badge badge-${item.state?.kind ?? 'unknown'}">${badge}</span>
  <span class="slug">${shortId}${project ? ` · ${project}` : ''}</span>
</div>
<h1>${item.url ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h1>
${culprit ? `<p class="meta"><code>${culprit}</code></p>` : ''}
<p class="meta">${level ? `level: ${level} · ` : ''}${escapeHtml(String(m.count ?? '0'))} events · ${escapeHtml(String(m.userCount ?? 0))} users${assignee ? ` · assigned to ${assignee}` : ''}</p>
<p class="meta">${firstSeen ? `first seen ${escapeHtml(firstSeen)}` : ''}${firstSeen && lastSeen ? ' · ' : ''}${lastSeen ? `last seen ${escapeHtml(lastSeen)}` : ''}</p>
${statusControl}
${item.url ? `<p><a href="${escapeHtml(item.url)}">View in Sentry →</a></p>` : ''}`;
  }
}
