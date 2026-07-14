import * as vscode from 'vscode';
import type { AuthStrategy, Reference } from '../../core/types';
import { isGitHubDotCom } from '../../core/gitRemote';

const PAT_KEY = 'revelo.github.pat';

export class GitHubAuth implements AuthStrategy {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    const pat = await this.secrets.get(PAT_KEY);
    if (pat) {
      return pat;
    }
    const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
    return session?.accessToken;
  }

  async signIn(): Promise<void> {
    await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
  }

  async setPat(token: string): Promise<void> {
    await this.secrets.store(PAT_KEY, token);
  }

  async clearPat(): Promise<void> {
    await this.secrets.delete(PAT_KEY);
  }

  baseUrl(ref: Reference): string {
    const host = ref.fields.host ?? 'github.com';
    return isGitHubDotCom(host) ? 'https://api.github.com' : `https://${host}/api/v3`;
  }
}
