import type { EditAction, EditOption } from './types';

/** Messages sent from the webview to the extension. */
export type InboundMessage =
  | {
      type: 'requestOptions';
      requestId: string;
      kind: 'transition' | 'assignee' | 'label';
      query: string;
    }
  | { type: 'applyEdit'; requestId: string; action: EditAction };

/** Messages sent from the extension to the webview. */
export type OutboundMessage =
  | { type: 'options'; requestId: string; options: EditOption[] }
  | { type: 'editResult'; requestId: string; ok: true }
  | { type: 'error'; requestId: string; message: string };
