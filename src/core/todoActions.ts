import * as vscode from 'vscode';
import {
  commentSpansForLine,
  getCommentSyntax,
  initialState,
  type Span,
} from './commentRanges';
import { DEFAULT_TODO_KEYWORDS, findTodos, type TodoMatch } from './todo';
import { TODO_DIAGNOSTIC_CODE, todoLintEnabled } from './todoDiagnostics';

export const CREATE_COMMAND = 'revelo.createJiraFromTodo';

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
export function unlinkedTodoOnLine(
  document: vscode.TextDocument,
  line: number,
): TodoMatch | undefined {
  const spans = commentSpansAtLine(document, line);
  const text = document.lineAt(line).text;
  return findTodos(text, spans, todoKeywords()).find((t) => !t.hasKey);
}

/** Insert "(KEY)" right after the TODO keyword on the line. */
export async function insertTodoKey(
  uri: vscode.Uri,
  line: number,
  todo: TodoMatch,
  key: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(line, todo.end), `(${key})`);
  await vscode.workspace.applyEdit(edit);
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
