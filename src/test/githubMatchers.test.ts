import { describe, it, expect } from 'vitest';
import { GITHUB_MATCHERS, parseMatch } from '../providers/github/matchers';

function matcher(kind: string) {
  const m = GITHUB_MATCHERS.find((x) => x.kind === kind)!;
  return () => new RegExp(m.regex.source, m.regex.flags);
}

function firstMatch(kind: string, text: string) {
  const re = matcher(kind)();
  const m = re.exec(text);
  return m ? parseMatch(kind, m) : undefined;
}

function allMatches(kind: string, text: string) {
  const re = matcher(kind)();
  return [...text.matchAll(re)];
}

describe('github url matcher', () => {
  it('parses an issue URL', () => {
    expect(firstMatch('url', 'see https://github.com/microsoft/vscode/issues/200000')).toEqual({
      kind: 'issue',
      host: 'github.com',
      owner: 'microsoft',
      repo: 'vscode',
      number: '200000',
      comment: undefined,
    });
  });

  it('parses a PR URL', () => {
    expect(firstMatch('url', 'https://github.com/octocat/Hello-World/pull/1')).toMatchObject({
      kind: 'pr',
      owner: 'octocat',
      repo: 'Hello-World',
      number: '1',
    });
  });

  it('parses a discussion URL', () => {
    expect(firstMatch('url', 'https://github.com/community/community/discussions/1')).toMatchObject({
      kind: 'discussion',
      number: '1',
    });
  });

  it('captures a comment anchor', () => {
    expect(
      firstMatch('url', 'https://github.com/a/b/issues/9#issuecomment-42'),
    ).toMatchObject({ number: '9', comment: '42' });
  });

  it('parses an enterprise host', () => {
    expect(firstMatch('url', 'https://ghe.corp.net/team/app/issues/7')).toMatchObject({
      host: 'ghe.corp.net',
      owner: 'team',
      repo: 'app',
      number: '7',
    });
  });
});

describe('github cross-repo matcher', () => {
  it('parses owner/repo#n', () => {
    expect(firstMatch('cross-repo', 'fixes microsoft/vscode#123 today')).toMatchObject({
      kind: 'issue',
      owner: 'microsoft',
      repo: 'vscode',
      number: '123',
    });
  });
});

describe('github bare matcher', () => {
  it('parses #123', () => {
    expect(firstMatch('bare', 'closes #123 here')).toMatchObject({ kind: 'bare', number: '123' });
  });

  it('parses GH-45', () => {
    expect(firstMatch('bare', 'see GH-45')).toMatchObject({ kind: 'bare', number: '45' });
  });

  it('does not match a color hex like #123abc as a number ref', () => {
    // #123abc — the \b after digits fails because letters follow, so no bare match
    expect(firstMatch('bare', 'color: #123abc;')).toBeUndefined();
  });

  it('does not fire bare inside owner/repo#n (lookbehind rejects word char)', () => {
    // "#123" is preceded by "e" (a word char), so the bare lookbehind fails and
    // only the cross-repo matcher claims it — no double count.
    expect(allMatches('bare', 'microsoft/vscode#123')).toHaveLength(0);
  });

  it('range text equals the reference (no leading char consumed)', () => {
    const re = matcher('bare')();
    const m = re.exec('closes #123 here')!;
    expect(m[0]).toBe('#123');
  });
});
