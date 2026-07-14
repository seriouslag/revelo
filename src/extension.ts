import * as vscode from 'vscode';
import { ProviderRegistry } from './core/registry';
import { ReferenceIndex } from './core/referenceIndex';
import { createHoverProvider, createLinkProvider } from './core/scanner';
import { WebviewManager } from './core/webviewManager';
import type { InboundMessage } from './core/webviewProtocol';
import type { Provider, Reference } from './core/types';
import { GitHubProvider } from './providers/github';
import { SentryProvider } from './providers/sentry';
import { JiraProvider } from './providers/jira';

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

  context.subscriptions.push(
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
