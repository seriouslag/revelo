import type { EditAction, EditOption } from './types';

/** A saved set of default field values for the create-from-TODO form. */
export interface JiraTicketTemplate {
  name: string;
  projectKey?: string;
  issueType?: string;
  priorityId?: string;
  parentKey?: string;
  labels?: string[];
  assigneeAccountId?: string;
  dueDate?: string;
}

/** A request to create a new Jira issue from the panel's create form. */
export interface CreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  labels?: string[];
  priorityId?: string;
  dueDate?: string;
  parentKey?: string;
  assigneeAccountId?: string;
}

/** Option feeds for the create form. */
export type CreateOptionKind = 'createAssignee' | 'epic' | 'label';

/** Messages sent from the webview to the extension. */
export type InboundMessage =
  | {
      type: 'requestOptions';
      requestId: string;
      kind: 'transition' | 'assignee' | 'label';
      query: string;
    }
  | { type: 'applyEdit'; requestId: string; action: EditAction }
  | { type: 'createIssue'; requestId: string; input: CreateIssueInput }
  | {
      type: 'createOptions';
      requestId: string;
      kind: CreateOptionKind;
      projectKey: string;
      query: string;
    };

/** Messages sent from the extension to the webview. */
export type OutboundMessage =
  | { type: 'options'; requestId: string; options: EditOption[] }
  | { type: 'editResult'; requestId: string; ok: true }
  | { type: 'created'; requestId: string; key: string }
  | { type: 'error'; requestId: string; message: string };
