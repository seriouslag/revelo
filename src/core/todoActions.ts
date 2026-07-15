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

function templateNames(): string[] {
  return vscode.workspace
    .getConfiguration('revelo.jira')
    .get<{ name?: string }[]>('ticketTemplates', [])
    .map((t) => t.name ?? '')
    .filter((n) => n.length > 0);
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
      const diagnostics = context.diagnostics.filter((d) => d.code === TODO_DIAGNOSTIC_CODE);
      const makeAction = (title: string, templateName?: string): vscode.CodeAction => {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.command = { command: CREATE_COMMAND, title, arguments: [document.uri, line, templateName] };
        // Associate with our diagnostic so it surfaces on the squiggle.
        action.diagnostics = diagnostics;
        return action;
      };
      // One action per saved template (each pre-fills the form from that
      // template), then a generic action last (plain form defaults, no template).
      const perTemplate = templateNames().map((name) =>
        makeAction(`Create Jira ${name} ticket from TODO`, name),
      );
      const generic = makeAction('Create Jira ticket from TODO');
      return [...perTemplate, generic];
    },
  };
}
