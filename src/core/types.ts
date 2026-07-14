import type * as vscode from 'vscode';

export type ProviderId = 'github' | 'sentry' | 'jira';

export interface ReferenceMatcher {
  kind: string;
  regex: RegExp;
}

export interface DocContext {
  document: vscode.TextDocument;
  line: number;
}

export interface Reference {
  providerId: ProviderId;
  kind: string;
  raw: string;
  range: vscode.Range;
  key: string;
  fields: Record<string, string>;
}

export type StateKind =
  | 'open'
  | 'closed-completed'
  | 'closed-notplanned'
  | 'closed-pr'
  | 'merged'
  | 'draft'
  | 'resolved'
  | 'unresolved'
  | 'in-progress'
  | 'unknown';

export interface StateBadge {
  label: string;
  kind: StateKind;
}

export interface ItemDetails {
  ref: Reference;
  title: string;
  url: string;
  fetchedAt: number;
  state?: StateBadge;
  meta: Record<string, unknown>;
  etag?: string;
}

export interface AuthStrategy {
  getToken(): Promise<string | undefined>;
  signIn(): Promise<void>;
  baseUrl(ref: Reference): string;
}

/** A selectable option for an edit control (status transition, assignee, …). */
export interface EditOption {
  id: string;
  label: string;
}

/** An edit action the webview can request. */
export type EditAction =
  // Jira
  | { type: 'transition'; transitionId: string }
  | { type: 'assign'; accountId: string | null }
  | { type: 'description'; text: string }
  // GitHub
  | { type: 'state'; state: 'open' | 'closed' }
  | { type: 'labels'; labels: string[] }
  | { type: 'assignees'; logins: string[] }
  // Sentry
  | { type: 'sentryStatus'; status: 'resolved' | 'ignored' | 'unresolved' };

/**
 * Optional editing capability. A provider that implements this exposes edit
 * controls in the detail panel; the webview posts EditActions back.
 */
export interface Editable {
  /** Whether editing is available for this reference (config + auth). */
  canEdit(ref: Reference): boolean;
  /** Options for a control, e.g. available transitions, users, or labels. */
  getOptions(
    ref: Reference,
    kind: 'transition' | 'assignee' | 'label',
    query: string,
  ): Promise<EditOption[]>;
  /** Apply an edit; resolves when the remote write succeeds. */
  applyEdit(ref: Reference, action: EditAction): Promise<void>;
}

export interface Provider {
  id: ProviderId;
  displayName: string;
  isEnabled(): boolean;
  matchers: ReferenceMatcher[];
  parse(match: RegExpMatchArray, ctx: DocContext): Omit<Reference, 'range'> | null;
  fetch(ref: Reference, token: vscode.CancellationToken): Promise<ItemDetails>;
  renderHover(item: ItemDetails): vscode.MarkdownString;
  renderPanel(item: ItemDetails, webview: vscode.Webview): string;
  auth: AuthStrategy;
  /** Clear any cached details (e.g. after an edit). */
  clearCache?(): void;
  /** Present when the provider supports editing. */
  editable?: Editable;
}
