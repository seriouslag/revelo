import * as vscode from 'vscode';
import type { JiraProvider } from '../providers/jira';
import {
  commentSpansForLine,
  getCommentSyntax,
  initialState,
  type Span,
} from './commentRanges';
import { DEFAULT_TODO_KEYWORDS, findTodos, type TodoMatch } from './todo';
import { TODO_DIAGNOSTIC_CODE, todoLintEnabled } from './todoDiagnostics';

const CREATE_COMMAND = 'revelo.createJiraFromTodo';

function isProse(languageId: string): boolean {
  return languageId === 'markdown' || languageId === 'plaintext';
}

function todoKeywords(): string[] {
  const configured = vscode.workspace
    .getConfiguration('revelo.jira')
    .get<string[]>('todoKeywords', DEFAULT_TODO_KEYWORDS);
  return configured.length > 0 ? configured : DEFAULT_TODO_KEYWORDS;
}

/** Comment spans for a single line, scanning from the top for block state. */
function commentSpansAtLine(document: vscode.TextDocument, targetLine: number): Span[] | undefined {
  if (isProse(document.languageId)) {
    return undefined;
  }
  const syntax = getCommentSyntax(document.languageId);
  if (!syntax) {
    return [];
  }
  let state = initialState();
  let spans: Span[] = [];
  for (let line = 0; line <= targetLine; line++) {
    const result = commentSpansForLine(document.lineAt(line).text, syntax, state);
    state = result.next;
    spans = result.spans;
  }
  return spans;
}

/** Find an unlinked TODO on the given line, if any. */
function unlinkedTodoOnLine(document: vscode.TextDocument, line: number): TodoMatch | undefined {
  const spans = commentSpansAtLine(document, line);
  const text = document.lineAt(line).text;
  return findTodos(text, spans, todoKeywords()).find((t) => !t.hasKey);
}

export function createTodoCodeActionProvider(): vscode.CodeActionProvider {
  return {
    provideCodeActions(document, range, context) {
      if (!todoLintEnabled()) {
        return [];
      }
      const line = range.start.line;
      const todo = unlinkedTodoOnLine(document, line);
      if (!todo) {
        return [];
      }
      const action = new vscode.CodeAction(
        'Create Jira ticket from TODO',
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: CREATE_COMMAND,
        title: 'Create Jira ticket from TODO',
        arguments: [document.uri, line],
      };
      // Associate with our diagnostic so it surfaces on the squiggle.
      action.diagnostics = context.diagnostics.filter((d) => d.code === TODO_DIAGNOSTIC_CODE);
      return [action];
    },
  };
}

/**
 * Command handler: create a Jira issue from the TODO on the given line, then
 * write the resulting key back into the comment as "TODO(KEY)".
 */
export async function createJiraFromTodo(
  jira: JiraProvider,
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const targetUri = uri ?? editor?.document.uri;
  if (!targetUri) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const targetLine = line ?? editor?.selection.active.line ?? 0;
  const todo = unlinkedTodoOnLine(document, targetLine);
  if (!todo) {
    vscode.window.showWarningMessage('Revelo: no unlinked TODO found on this line.');
    return;
  }

  const projectKey = await pickProjectKey(jira);
  if (!projectKey) {
    return;
  }
  const issueType = await pickIssueType();
  if (!issueType) {
    return;
  }
  const summary = await vscode.window.showInputBox({
    prompt: 'Jira issue summary',
    value: todo.summary || todo.keyword,
    ignoreFocusOut: true,
  });
  if (!summary) {
    return;
  }

  let key: string;
  try {
    key = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Revelo: creating Jira issue…' },
      () => jira.createIssue({ projectKey, issueType, summary }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Revelo: could not create Jira issue — ${message}`);
    return;
  }

  await insertKey(targetUri, targetLine, todo, key);
  vscode.window.showInformationMessage(`Revelo: created ${key}`);
}

async function pickProjectKey(jira: JiraProvider): Promise<string | undefined> {
  const keys = vscode.workspace.getConfiguration('revelo.jira').get<string[]>('projectKeys', []);
  const fallback = jira.defaultProjectKey();
  if (keys.length <= 1) {
    return (
      keys[0] ??
      fallback ??
      (await vscode.window.showInputBox({ prompt: 'Jira project key', ignoreFocusOut: true }))
    );
  }
  return vscode.window.showQuickPick(keys, { placeHolder: 'Jira project key' });
}

async function pickIssueType(): Promise<string | undefined> {
  const types = vscode.workspace
    .getConfiguration('revelo.jira')
    .get<string[]>('issueTypes', ['Task', 'Bug', 'Story']);
  const def = types[0] ?? 'Task';
  const picked = await vscode.window.showQuickPick(types, {
    placeHolder: `Issue type (default ${def})`,
  });
  return picked ?? undefined;
}

/** Insert "(KEY)" right after the TODO keyword on the line. */
async function insertKey(
  uri: vscode.Uri,
  line: number,
  todo: TodoMatch,
  key: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(line, todo.end), `(${key})`);
  await vscode.workspace.applyEdit(edit);
}

export { CREATE_COMMAND };
