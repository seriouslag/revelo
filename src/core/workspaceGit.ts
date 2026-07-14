import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseRemoteUrl, type RemoteInfo } from './gitRemote';

const execFileAsync = promisify(execFile);

/** Read origin (fallback upstream) for a workspace folder and parse it. */
export async function getWorkspaceRemote(cwd: string): Promise<RemoteInfo | undefined> {
  for (const remote of ['origin', 'upstream']) {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', remote], { cwd });
      const info = parseRemoteUrl(stdout);
      if (info) {
        return info;
      }
    } catch {
      // remote not configured; try next
    }
  }
  return undefined;
}
