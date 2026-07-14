export interface RemoteInfo {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into host/owner/repo. Handles:
 *   https://github.com/owner/repo(.git)
 *   git@github.com:owner/repo(.git)
 *   ssh://git@github.com/owner/repo(.git)
 * Returns undefined when the URL is not a recognizable git remote.
 */
export function parseRemoteUrl(url: string): RemoteInfo | undefined {
  const trimmed = url.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/|git@|ssh:\/\/git@)([^/:]+)[/:]([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (!match) {
    return undefined;
  }
  const [, host, owner, repo] = match;
  if (!host || !owner || !repo) {
    return undefined;
  }
  return { host, owner, repo };
}

/** Whether a host is github.com (vs. a GitHub Enterprise host). */
export function isGitHubDotCom(host: string): boolean {
  return host.toLowerCase() === 'github.com';
}
