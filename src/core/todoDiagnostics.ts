import * as vscode from 'vscode';
import {
  commentSpansForLine,
  getCommentSyntax,
  initialState,
  type Span,
} from './commentRanges';
import { DEFAULT_TODO_KEYWORDS, findTodos } from './todo';

export const TODO_DIAGNOSTIC_SOURCE = 'Revelo';
export const TODO_DIAGNOSTIC_CODE = 'todo-missing-jira';

function isProse(languageId: string): boolean {
  return languageId === 'markdown' || languageId === 'plaintext';
}

function todoKeywords(): string[] {
  const configured = vscode.workspace
    .getConfiguration('revelo.jira')
    .get<string[]>('todoKeywords', DEFAULT_TODO_KEYWORDS);
  return configured.length > 0 ? configured : DEFAULT_TODO_KEYWORDS;
}

/** Whether TODO linting is active: Jira enabled and lint turned on. */
export function todoLintEnabled(): boolean {
  const cfg = vscode.workspace.getConfiguration('revelo.jira');
  return cfg.get('enabled', false) && cfg.get('requireTicketForTodo', false);
}

/** Compute unlinked-TODO diagnostics for a document. */
export function computeTodoDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const prose = isProse(document.languageId);
  const syntax = getCommentSyntax(document.languageId);
  if (!prose && !syntax) {
    return [];
  }
  const keywords = todoKeywords();
  const diagnostics: vscode.Diagnostic[] = [];
  let state = initialState();

  for (let line = 0; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    let spans: Span[] | undefined;
    if (prose) {
      spans = undefined;
    } else {
      const result = commentSpansForLine(text, syntax!, state);
      state = result.next;
      spans = result.spans;
    }
    for (const todo of findTodos(text, spans, keywords)) {
      if (todo.hasKey) {
        continue;
      }
      const range = new vscode.Range(line, todo.start, line, text.length);
      const diagnostic = new vscode.Diagnostic(
        range,
        `${todo.keyword} has no linked Jira ticket`,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = TODO_DIAGNOSTIC_SOURCE;
      diagnostic.code = TODO_DIAGNOSTIC_CODE;
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

/**
 * Wire up a DiagnosticCollection that refreshes on document open/change and
 * config change. Returns disposables for the caller to register.
 */
export function registerTodoDiagnostics(): vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection('revelo-todo');

  const refresh = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== 'file' || !todoLintEnabled()) {
      collection.delete(document.uri);
      return;
    }
    collection.set(document.uri, computeTodoDiagnostics(document));
  };

  const refreshAll = (): void => {
    collection.clear();
    for (const document of vscode.workspace.textDocuments) {
      refresh(document);
    }
  };

  refreshAll();

  return [
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('revelo.jira')) {
        refreshAll();
      }
    }),
  ];
}
