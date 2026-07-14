import * as vscode from 'vscode';
import type { AuthStrategy, Reference } from '../../core/types';

const TOKEN_KEY = 'revelo.jira.token';

export class JiraAuth implements AuthStrategy {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getToken(): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(TOKEN_KEY));
  }

  async signIn(): Promise<void> {
    const token = await vscode.window.showInputBox({
      prompt: 'Jira API token (create at id.atlassian.com/manage/api-tokens)',
      password: true,
      ignoreFocusOut: true,
    });
    if (token) {
      await this.secrets.store(TOKEN_KEY, token);
      vscode.window.showInformationMessage('Revelo: Jira token saved');
    }
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
  }

  email(): string {
    return vscode.workspace.getConfiguration('revelo.jira').get<string>('email', '');
  }

  /**
   * The Jira site base URL. A cloud-URL reference carries its own site
   * subdomain; otherwise fall back to the configured site.
   */
  baseUrl(ref: Reference): string {
    const site = ref.fields.site;
    if (site) {
      return `https://${site}.atlassian.net`;
    }
    return vscode.workspace
      .getConfiguration('revelo.jira')
      .get<string>('siteUrl', '')
      .replace(/\/+$/, '');
  }
}
