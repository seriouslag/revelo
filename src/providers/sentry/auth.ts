import * as vscode from 'vscode';
import type { AuthStrategy, Reference } from '../../core/types';

const TOKEN_KEY = 'revelo.sentry.token';

export class SentryAuth implements AuthStrategy {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getToken(): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(TOKEN_KEY));
  }

  async signIn(): Promise<void> {
    const token = await vscode.window.showInputBox({
      prompt: 'Sentry User Auth Token (needs event:read, project:read, org:read)',
      password: true,
      ignoreFocusOut: true,
    });
    if (token) {
      await this.secrets.store(TOKEN_KEY, token);
      vscode.window.showInformationMessage('Revelo: Sentry token saved');
    }
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
  }

  /**
   * Use the host from the matched URL when present. Sentry org subdomains
   * (e.g. tradeshiftcom.sentry.io) and region hosts (us/de.sentry.io) both
   * auto-route to the correct region's API, and self-hosted hosts are used
   * directly. Falls back to the configured base URL for short IDs (no host).
   */
  baseUrl(ref: Reference): string {
    const host = ref.fields.host;
    if (host) {
      return `https://${host}`;
    }
    return vscode.workspace
      .getConfiguration('revelo.sentry')
      .get<string>('apiBaseUrl', 'https://sentry.io');
  }
}
