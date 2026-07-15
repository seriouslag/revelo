import * as vscode from 'vscode';
import type { InboundMessage, OutboundMessage } from './webviewProtocol';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export interface ShowOptions {
  title: string;
  renderBody: (webview: vscode.Webview) => string;
  onMessage?: (message: InboundMessage) => void;
}

export class WebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private messageSub: vscode.Disposable | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      'revelo.detail',
      'Revelo',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );
    panel.onDidDispose(() => {
      this.messageSub?.dispose();
      this.messageSub = undefined;
      this.panel = undefined;
    });
    this.panel = panel;
    return panel;
  }

  show(options: ShowOptions): void {
    const panel = this.ensurePanel();

    // Rewire the message handler for this content (a new render may carry a
    // different reference/handler).
    this.messageSub?.dispose();
    this.messageSub = options.onMessage
      ? panel.webview.onDidReceiveMessage(options.onMessage as (m: unknown) => void)
      : undefined;

    panel.title = `Revelo: ${options.title}`;
    panel.webview.html = this.wrap(panel.webview, options.renderBody(panel.webview));
    panel.reveal(vscode.ViewColumn.Beside);
  }

  close(): void {
    this.panel?.dispose();
  }

  post(message: OutboundMessage): void {
    // VS Code's Webview.postMessage takes no targetOrigin (not DOM postMessage).
    // oxlint-disable-next-line require-post-message-target-origin
    this.panel?.webview.postMessage(message);
  }

  private wrap(webview: vscode.Webview, bodyHtml: string): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.js'),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground);
         padding: 4px 24px 24px; line-height: 1.6; max-width: 900px; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .header { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 8px 0 4px; line-height: 1.3; }
  h1 a { color: var(--vscode-editor-foreground); }
  h1 a:hover { color: var(--vscode-textLink-foreground); }
  .badge { display: inline-flex; align-items: center; padding: 3px 12px; border-radius: 20px;
           font-size: 0.85em; font-weight: 600; color: #fff; }
  .badge-open { background: #238636; }
  .badge-closed-completed { background: #8957e5; }
  .badge-closed-notplanned { background: #6e7781; }
  .badge-closed-pr { background: #da3633; }
  .badge-merged { background: #8957e5; }
  .badge-draft { background: #6e7781; }
  .badge-resolved { background: #238636; }
  .badge-unresolved { background: #da3633; }
  .badge-in-progress { background: #bb8009; }
  .badge-unknown { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .slug { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 4px 0 12px; }
  .labels { margin: 0 0 16px; }
  .label { display: inline-block; padding: 2px 10px; margin: 2px 4px 2px 0; border-radius: 20px;
           border: 1px solid var(--vscode-panel-border); font-size: 0.82em;
           color: var(--vscode-descriptionForeground); }
  .body { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border);
          white-space: pre-wrap; word-wrap: break-word; }
  .edit-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
  .edit-row label { min-width: 80px; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  select, textarea, button, input {
    font-family: var(--vscode-font-family); font-size: 0.9em; color: var(--vscode-input-foreground);
    background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 4px 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; cursor: pointer; padding: 4px 14px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  textarea { width: 100%; min-height: 120px; resize: vertical; white-space: pre-wrap;
             font-family: var(--vscode-editor-font-family); }
  .summary-input { flex: 1; min-height: 0; resize: none; overflow: hidden;
                   font-family: var(--vscode-font-family); line-height: 1.4; }
  .edit-body { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); }
  .combobox { position: relative; display: inline-block; min-width: 260px; }
  .combobox input { width: 100%; box-sizing: border-box; }
  .combobox-list { position: absolute; z-index: 10; left: 0; right: 0; top: 100%; margin: 2px 0 0;
                   padding: 0; list-style: none; max-height: 220px; overflow-y: auto;
                   background: var(--vscode-dropdown-background, var(--vscode-input-background));
                   border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
                   border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .combobox-list li { padding: 5px 10px; cursor: pointer; font-size: 0.9em; }
  .combobox-list li:hover, .combobox-list li.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground); }
  .combobox-list li.empty { color: var(--vscode-descriptionForeground); cursor: default; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px;
          border-radius: 20px; font-size: 0.82em; background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground); }
  .chip button { background: none; border: none; color: inherit; cursor: pointer; padding: 0 2px;
                 font-size: 1.1em; line-height: 1; }
  .chip button:hover { background: none; opacity: 0.7; }
  .spinner { display: inline-block; width: 12px; height: 12px; vertical-align: -1px;
             border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent;
             border-radius: 50%; animation: rv-spin 0.7s linear infinite; }
  @keyframes rv-spin { to { transform: rotate(360deg); } }
  .loading-panel { position: fixed; inset: 0; display: flex; flex-direction: column;
                   align-items: center; justify-content: center; gap: 10px; }
  .loading-panel .spinner { width: 22px; height: 22px; border-width: 3px; }
  .loading-panel .meta { margin: 0; }
  .label-toggles { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .label-toggle { padding: 1px 10px; border-radius: 20px; font-size: 0.82em; cursor: pointer;
                  border: 1px solid var(--vscode-panel-border); background: none;
                  color: var(--vscode-foreground); }
  .label-toggle:hover { background: var(--vscode-toolbar-hoverBackground); }
  .label-toggle.selected { background: var(--vscode-badge-background);
                           color: var(--vscode-badge-foreground);
                           border-color: var(--vscode-badge-background); }
  .label-editor { margin: 4px 0 12px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border);
                  border-radius: 4px; max-width: 400px; }
  .label-search { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
  .label-list { max-height: 220px; overflow-y: auto; }
  .label-check { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 0.9em; }
  .label-check input { width: auto; }
  .label-editor button { margin-top: 8px; }
  .status-msg { font-size: 0.85em; margin-left: 8px; }
  .status-msg.ok { color: var(--vscode-testing-iconPassed, #238636); }
  .status-msg.err { color: var(--vscode-errorForeground, #da3633); }
</style>
</head>
<body>
${bodyHtml}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.messageSub?.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }
}
