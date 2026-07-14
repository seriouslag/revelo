import type { Reference } from './types';

/** Remembers the most recently seen Reference for each key so commands
 *  (e.g. openPanel) can resolve a key back to a full reference. */
export class ReferenceIndex {
  private readonly byKey = new Map<string, Reference>();

  remember(ref: Reference): void {
    this.byKey.set(ref.key, ref);
  }

  get(key: string): Reference | undefined {
    return this.byKey.get(key);
  }
}
