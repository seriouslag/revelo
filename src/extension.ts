import * as vscode from 'vscode';
import { ProviderRegistry } from './core/registry';
import { ReferenceIndex } from './core/referenceIndex';
import { createHoverProvider, createLinkProvider } from './core/scanner';
import { registerTodoDiagnostics } from './core/todoDiagnostics';
import {
  createTodoCodeActionProvider,
  unlinkedTodoOnLine,
  insertTodoKey,
  CREATE_COMMAND,
} from './core/todoActions';
import { WebviewManager } from './core/webviewManager';
import {
  renderCreatePanel,
  renderCreateLoading,
  type JiraTicketTemplate,
} from './providers/jira/createPanel';
import type { CreateOptionKind, InboundMessage } from './core/webviewProtocol';
import type { EditOption, Provider, ProviderId, Reference } from './core/types';
import { GitHubProvider } from './providers/github';
import { SentryProvider } from './providers/sentry';
import { JiraProvider, type JiraCreateMeta } from './providers/jira';

export function activate(context: vscode.ExtensionContext): void {
  const registry = new ProviderRegistry();
  const github = new GitHubProvider(context.secrets);
  const sentry = new SentryProvider(context.secrets);
  const jira = new JiraProvider(context.secrets);
  registry.register(github);
  registry.register(sentry);
  registry.register(jira);

  const index = new ReferenceIndex();
  const webview = new WebviewManager(context.extensionUri);
  const selector: vscode.DocumentSelector = { scheme: 'file' };

  async function openPanel(key?: string): Promise<void> {
    const ref = key ? index.get(key) : undefined;
    if (!ref) {
      vscode.window.showWarningMessage('Revelo: reference not found — hover it first.');
      return;
    }
    const provider = registry.get(ref.providerId);
    if (!provider) {
      return;
    }
    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const details = await provider.fetch(ref, tokenSource.token);
      webview.show({
        title: details.title,
        renderBody: (w) => provider.renderPanel(details, w),
        onMessage: (message) => handlePanelMessage(provider, ref, message, key),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`Revelo: could not load ${ref.raw} — ${message}`);
    }
  }

  // Open the panel with a Jira "create issue from TODO" form. On success,
  // write the new key back into the comment and show the created issue.
  async function openCreatePanel(
    uri?: vscode.Uri,
    line?: number,
    templateName?: string,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const targetUri = uri ?? editor?.document.uri;
    if (!targetUri) {
      return;
    }

    // Show the panel immediately with a loading state, before any async work, so
    // the spinner paints without waiting on the document read or options fetch.
    webview.show({ title: 'Create Jira ticket', renderBody: () => renderCreateLoading() });

    const document = await vscode.workspace.openTextDocument(targetUri);
    const targetLine = line ?? editor?.selection.active.line ?? 0;
    const todo = unlinkedTodoOnLine(document, targetLine);
    if (!todo) {
      webview.close();
      vscode.window.showWarningMessage('Revelo: no unlinked TODO found on this line.');
      return;
    }

    const cfg = vscode.workspace.getConfiguration('revelo.jira');
    const projectKeys = cfg.get<string[]>('projectKeys', []);
    const templates = cfg.get<JiraTicketTemplate[]>('ticketTemplates', []);

    // Options come prefetched from Jira; if that fails it's an auth/connection
    // problem, so close the panel and surface the error rather than leaving an
    // empty form open.
    let meta: JiraCreateMeta;
    try {
      meta = await jira.getCreateMeta();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      webview.close();
      vscode.window.showErrorMessage(`Revelo: cannot load Jira options — ${msg}`);
      return;
    }

    // The quick action carries the chosen template's name; the generic action
    // and command palette pass nothing (plain form defaults).
    const preselectTemplateIndex = templateName
      ? templates.findIndex((t) => t.name === templateName)
      : -1;

    // Optional allowlists trim the (often huge) Jira lists down to the ones the
    // team actually uses. Empty setting = show everything.
    const visibleTypes = lowerAll(cfg.get<string[]>('visibleIssueTypes', []));
    const visiblePriorities = lowerAll(cfg.get<string[]>('visiblePriorities', []));
    const issueTypes = visibleTypes.length
      ? meta.issueTypes.filter((t) => visibleTypes.includes(t.name.toLowerCase()))
      : meta.issueTypes;
    const priorities = visiblePriorities.length
      ? meta.priorities.filter(
          (p) =>
            visiblePriorities.includes(p.id.toLowerCase()) ||
            visiblePriorities.includes(p.name.toLowerCase()),
        )
      : meta.priorities;
    const visibleLabels = lowerAll(cfg.get<string[]>('visibleLabels', []));
    const labels = visibleLabels.length
      ? meta.labels.filter((l) => visibleLabels.includes(l.toLowerCase()))
      : meta.labels;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
    const relPath = workspaceFolder
      ? targetUri.path.slice(workspaceFolder.uri.path.length + 1)
      : targetUri.fsPath;
    const description = `Created from a TODO in ${relPath}:${targetLine + 1}\n\n${document.lineAt(targetLine).text.trim()}`;

    webview.show({
      title: 'Create Jira ticket',
      renderBody: () =>
        renderCreatePanel({
          projectKeys,
          issueTypes: issueTypes.map((t) => t.name),
          // A curated or short list is friendlier as a plain dropdown; only fall
          // back to a searchable combobox for the full (often huge) Jira list.
          typeAsDropdown: visibleTypes.length > 0 || issueTypes.length < 10,
          priorities,
          labels,
          // Short/curated label lists show as toggle chips; the full list stays a
          // search combobox.
          labelsAsChips: visibleLabels.length > 0 || labels.length < 10,
          epicsByProject: meta.epicsByProject,
          summary: todo.summary || todo.keyword,
          description,
          templates,
          preselectTemplateIndex,
          debug: cfg.get<boolean>('debug', false),
        }),
      onMessage: async (message) => {
        if (message.type === 'createOptions') {
          try {
            const options = await createOptions(jira, message.kind, message.projectKey, message.query);
            webview.post({ type: 'options', requestId: message.requestId, options });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            webview.post({ type: 'error', requestId: message.requestId, message: msg });
          }
          return;
        }
        if (message.type !== 'createIssue') {
          return;
        }
        try {
          const key = await jira.createIssue(message.input);
          webview.post({ type: 'created', requestId: message.requestId, key });
          await insertTodoKey(targetUri, targetLine, todo, key);
          // Swap the panel to the freshly created issue's detail view.
          const ref = jira.refForKey(key);
          index.remember({ ...ref, range: new vscode.Range(targetLine, 0, targetLine, 0) });
          void openPanel(ref.key);
          const viewTicket = 'View ticket';
          void vscode.window
            .showInformationMessage(`Revelo: created ${key}`, viewTicket)
            .then((choice) => {
              if (choice === viewTicket) {
                void vscode.env.openExternal(vscode.Uri.parse(jira.issueUrl(key)));
              }
            });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          webview.post({ type: 'error', requestId: message.requestId, message: msg });
        }
      },
    });
  }

  async function handlePanelMessage(
    provider: Provider,
    ref: Reference,
    message: InboundMessage,
    key: string | undefined,
  ): Promise<void> {
    const editable = provider.editable;
    if (!editable) {
      return;
    }
    try {
      if (message.type === 'requestOptions') {
        const options = await editable.getOptions(ref, message.kind, message.query);
        webview.post({ type: 'options', requestId: message.requestId, options });
        return;
      }
      if (message.type === 'applyEdit') {
        await editable.applyEdit(ref, message.action);
        webview.post({ type: 'editResult', requestId: message.requestId, ok: true });
        // Invalidate the cache and re-render the panel with fresh data.
        provider.clearCache?.();
        void refreshPanel(provider, ref, key);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      webview.post({ type: 'error', requestId: message.requestId, message: msg });
    }
  }

  async function refreshPanel(
    provider: Provider,
    ref: Reference,
    key: string | undefined,
  ): Promise<void> {
    try {
      const tokenSource = new vscode.CancellationTokenSource();
      const details = await provider.fetch(ref, tokenSource.token);
      webview.show({
        title: details.title,
        renderBody: (w) => provider.renderPanel(details, w),
        onMessage: (message) => handlePanelMessage(provider, ref, message, key),
      });
    } catch {
      // Leave the current panel content; the edit already succeeded.
    }
  }

  void warnMissingTokens(context, [
    { provider: sentry, command: 'revelo.setSentryToken' },
    { provider: jira, command: 'revelo.setJiraToken' },
  ]);

  // Warm the create-form options (issue types, priorities, labels, epics) so the
  // form opens instantly. Best-effort: a missing token just skips it.
  void jira.prefetchCreateMeta();

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    void vscode.commands.executeCommand('setContext', 'revelo.devMode', true);
    const clearToken = async (
      providerId: ProviderId,
      clear: () => Promise<void>,
    ): Promise<void> => {
      await clear();
      await context.globalState.update(`revelo.tokenAlertDismissed.${providerId}`, false);
      vscode.window.showInformationMessage(`Revelo: ${providerId} token cleared`);
    };
    context.subscriptions.push(
      vscode.commands.registerCommand('revelo.clearGitHubToken', () =>
        clearToken('github', () => github.auth.clearPat()),
      ),
      vscode.commands.registerCommand('revelo.clearSentryToken', () =>
        clearToken('sentry', () => sentry.auth.clearToken()),
      ),
      vscode.commands.registerCommand('revelo.clearJiraToken', () =>
        clearToken('jira', () => jira.auth.clearToken()),
      ),
    );
  }

  context.subscriptions.push(
    ...registerTodoDiagnostics(),
    vscode.languages.registerCodeActionsProvider(selector, createTodoCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand(
      CREATE_COMMAND,
      (uri?: vscode.Uri, line?: number, templateName?: string) =>
        openCreatePanel(uri, line, templateName),
    ),
    vscode.languages.registerHoverProvider(selector, createHoverProvider(registry, index)),
    vscode.languages.registerDocumentLinkProvider(selector, createLinkProvider(registry, index)),
    vscode.commands.registerCommand('revelo.openPanel', openPanel),
    vscode.commands.registerCommand('revelo.signInGitHub', () => github.auth.signIn()),
    vscode.commands.registerCommand('revelo.setSentryToken', () => sentry.auth.signIn()),
    vscode.commands.registerCommand('revelo.setJiraToken', () => jira.auth.signIn()),
    vscode.commands.registerCommand('revelo.clearCache', () => {
      github.clearCache();
      sentry.clearCache();
      jira.clearCache();
      vscode.window.showInformationMessage('Revelo: cache cleared');
    }),
    vscode.commands.registerCommand('revelo.setGitHubToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'GitHub personal access token (stored in SecretStorage)',
        password: true,
      });
      if (token) {
        await github.auth.setPat(token);
        vscode.window.showInformationMessage('Revelo: GitHub token saved');
      }
    }),
  );
}

export function deactivate(): void {}

// Feed the create form's dynamic controls: priorities, project assignees, and
function lowerAll(values: string[]): string[] {
  return values.map((v) => v.toLowerCase());
}

// epic search. Returns generic {id,label} options the combobox/select render.
async function createOptions(
  jira: JiraProvider,
  kind: CreateOptionKind,
  projectKey: string,
  query: string,
): Promise<EditOption[]> {
  if (kind === 'createAssignee') {
    const debug = vscode.workspace.getConfiguration('revelo.jira').get<boolean>('debug', false);
    const users = await jira.getAssignableUsersForProject(projectKey, query);
    return users.map((u) => {
      const base = u.emailAddress ? `${u.displayName} (${u.emailAddress})` : u.displayName;
      return { id: u.accountId, label: debug ? `${base} [id: ${u.accountId}]` : base };
    });
  }
  const meta = await jira.getCreateMeta();
  if (kind === 'label') {
    const visible = vscode.workspace
      .getConfiguration('revelo.jira')
      .get<string[]>('visibleLabels', [])
      .map((l) => l.toLowerCase());
    const labels = visible.length
      ? meta.labels.filter((l) => visible.includes(l.toLowerCase()))
      : meta.labels;
    return labels.map((l) => ({ id: l, label: l }));
  }
  // Prefetched epics when the project was in range; otherwise fetch on demand.
  const epics =
    meta.epicsByProject[projectKey.toUpperCase()] ?? (await jira.searchEpics(projectKey));
  return epics.map((e) => ({ id: e.key, label: `${e.key} — ${e.summary}` }));
}

async function warnMissingTokens(
  context: vscode.ExtensionContext,
  targets: { provider: Provider; command: string }[],
): Promise<void> {
  for (const { provider, command } of targets) {
    if (!provider.isEnabled()) {
      continue;
    }
    if (await provider.auth.getToken()) {
      continue;
    }
    const dismissKey = `revelo.tokenAlertDismissed.${provider.id}`;
    if (context.globalState.get<boolean>(dismissKey)) {
      continue;
    }
    const setToken = 'Set token';
    const dismiss = "Don't show again";
    const choice = await vscode.window.showWarningMessage(
      `Revelo: ${provider.displayName} is enabled but has no token set — references won't resolve.`,
      setToken,
      dismiss,
    );
    if (choice === setToken) {
      await vscode.commands.executeCommand(command);
    } else if (choice === dismiss) {
      await context.globalState.update(dismissKey, true);
    }
  }
}
