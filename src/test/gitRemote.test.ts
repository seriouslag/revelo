import { describe, it, expect } from 'vitest';
import { parseRemoteUrl, isGitHubDotCom } from '../core/gitRemote';

describe('parseRemoteUrl', () => {
  it('parses https with .git', () => {
    expect(parseRemoteUrl('https://github.com/microsoft/vscode.git')).toEqual({
      host: 'github.com',
      owner: 'microsoft',
      repo: 'vscode',
    });
  });

  it('parses https without .git', () => {
    expect(parseRemoteUrl('https://github.com/octocat/Hello-World')).toEqual({
      host: 'github.com',
      owner: 'octocat',
      repo: 'Hello-World',
    });
  });

  it('parses scp-style git@ url', () => {
    expect(parseRemoteUrl('git@github.com:microsoft/vscode.git')).toEqual({
      host: 'github.com',
      owner: 'microsoft',
      repo: 'vscode',
    });
  });

  it('parses ssh:// url', () => {
    expect(parseRemoteUrl('ssh://git@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses an enterprise host', () => {
    expect(parseRemoteUrl('git@ghe.corp.net:team/app.git')).toEqual({
      host: 'ghe.corp.net',
      owner: 'team',
      repo: 'app',
    });
  });

  it('returns undefined for a non-git url', () => {
    expect(parseRemoteUrl('not a url')).toBeUndefined();
  });

  it('detects github.com vs enterprise', () => {
    expect(isGitHubDotCom('github.com')).toBe(true);
    expect(isGitHubDotCom('GitHub.com')).toBe(true);
    expect(isGitHubDotCom('ghe.corp.net')).toBe(false);
  });
});
