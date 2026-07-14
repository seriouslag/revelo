import type { ReferenceMatcher } from '../../core/types';

// Order matters: URL patterns run before short patterns so a full URL is not
// also matched as a bare #number. The scanner dedupes by range, but ordering
// keeps the richer match (with owner/repo) winning.
export const GITHUB_MATCHERS: ReferenceMatcher[] = [
  {
    kind: 'url',
    regex:
      /https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/(issues|pull|discussions)\/(\d+)(?:#issuecomment-(\d+))?/g,
  },
  {
    kind: 'cross-repo',
    regex: /\b([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)#(\d+)\b/g,
  },
  {
    kind: 'bare',
    regex: /(?<![\w/])(#|GH-)(\d+)\b/g,
  },
];

export type ParsedRef =
  | { kind: 'issue' | 'pr' | 'discussion'; host: string; owner: string; repo: string; number: string; comment?: string }
  | { kind: 'bare'; number: string };

const URL_KIND: Record<string, 'issue' | 'pr' | 'discussion'> = {
  issues: 'issue',
  pull: 'pr',
  discussions: 'discussion',
};

export function parseMatch(kind: string, m: RegExpMatchArray): ParsedRef | undefined {
  switch (kind) {
    case 'url': {
      const [, host, owner, repo, seg, number, comment] = m;
      return { kind: URL_KIND[seg], host, owner, repo, number, comment };
    }
    case 'cross-repo': {
      const [, owner, repo, number] = m;
      return { kind: 'issue', host: 'github.com', owner, repo, number };
    }
    case 'bare': {
      const number = m[2];
      return { kind: 'bare', number };
    }
    default:
      return undefined;
  }
}
