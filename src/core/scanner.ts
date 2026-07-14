import * as vscode from 'vscode';
import type { ProviderRegistry } from './registry';
import type { ReferenceIndex } from './referenceIndex';
import type { Provider, Reference } from './types';
import {
  commentSpansForLine,
  getCommentSyntax,
  initialState,
  offsetInSpans,
  type Span,
} from './commentRanges';

const OPEN_PANEL = 'revelo.openPanel';

/** True when the language is prose-like (whole document is scannable). */
function isProse(languageId: string): boolean {
  return languageId === 'markdown' || languageId === 'plaintext';
}

/** Comment spans for a single line, scanning from the top for block state. */
function commentSpansAtLine(document: vscode.TextDocument, targetLine: number): Span[] {
  const syntax = getCommentSyntax(document.languageId);
  if (!syntax) {
    return [];
  }
  let state = initialState();
  let spans: Span[] = [];
  for (let line = 0; line <= targetLine; line++) {
    const text = document.lineAt(line).text;
    const result = commentSpansForLine(text, syntax, state);
    state = result.next;
    spans = result.spans;
  }
  return spans;
}

/** Whether a character offset on a line is scannable for references. */
function isScannable(document: vscode.TextDocument, line: number, offset: number): boolean {
  if (isProse(document.languageId)) {
    return true;
  }
  return offsetInSpans(offset, commentSpansAtLine(document, line));
}

/** Find all references on a line, filtered to comment/prose spans. */
function referencesOnLine(
  document: vscode.TextDocument,
  line: number,
  providers: Provider[],
): Reference[] {
  const text = document.lineAt(line).text;
  const prose = isProse(document.languageId);
  const spans = prose ? undefined : commentSpansAtLine(document, line);
  const refs: Reference[] = [];

  for (const provider of providers) {
    for (const matcher of provider.matchers) {
      const regex = new RegExp(matcher.regex.source, matcher.regex.flags.replace('g', '') + 'g');
      for (const match of text.matchAll(regex)) {
        const start = match.index ?? 0;
        if (spans && !offsetInSpans(start, spans)) {
          continue;
        }
        const parsed = provider.parse(match, { document, line });
        if (!parsed) {
          continue;
        }
        const range = new vscode.Range(line, start, line, start + match[0].length);
        refs.push({ ...parsed, range });
      }
    }
  }
  return refs;
}

export function createHoverProvider(
  registry: ProviderRegistry,
  index: ReferenceIndex,
): vscode.HoverProvider {
  return {
    async provideHover(document, position, token) {
      const providers = registry.enabled();
      if (providers.length === 0 || !isScannable(document, position.line, position.character)) {
        return undefined;
      }
      const refs = referencesOnLine(document, position.line, providers);
      const ref = refs.find((r) => r.range.contains(position));
      if (!ref) {
        return undefined;
      }
      index.remember(ref);
      const provider = registry.get(ref.providerId);
      if (!provider) {
        return undefined;
      }
      try {
        const item = await provider.fetch(ref, token);
        const md = provider.renderHover(item);
        return new vscode.Hover(md, ref.range);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const md = new vscode.MarkdownString(
          `$(warning) **${provider.displayName}**: ${message}`,
        );
        md.supportThemeIcons = true;
        return new vscode.Hover(md, ref.range);
      }
    },
  };
}

export function createLinkProvider(
  registry: ProviderRegistry,
  index: ReferenceIndex,
): vscode.DocumentLinkProvider {
  return {
    provideDocumentLinks(document) {
      const providers = registry.enabled();
      if (providers.length === 0) {
        return [];
      }
      const links: vscode.DocumentLink[] = [];
      for (let line = 0; line < document.lineCount; line++) {
        for (const ref of referencesOnLine(document, line, providers)) {
          index.remember(ref);
          const provider = registry.get(ref.providerId);
          const args = encodeURIComponent(JSON.stringify([ref.key]));
          const link = new vscode.DocumentLink(
            ref.range,
            vscode.Uri.parse(`command:${OPEN_PANEL}?${args}`),
          );
          link.tooltip = `Open ${provider?.displayName ?? ref.providerId} details`;
          links.push(link);
        }
      }
      return links;
    },
  };
}
