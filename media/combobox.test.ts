// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCombobox } from './combobox';
import type { EditOption } from '../src/core/types';

// The combobox debounces loads by 250ms. Advance timers, then flush the
// microtask queue so the awaited load() promise resolves and renders.
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300);
}

function setup(html: string) {
  document.body.innerHTML = html;
  const input = document.querySelector<HTMLInputElement>('input')!;
  const list = document.querySelector<HTMLUListElement>('ul')!;
  const chips = document.querySelector<HTMLDivElement>('.chips') ?? undefined;
  return { input, list, chips };
}

function rowLabels(list: HTMLUListElement): string[] {
  return [...list.querySelectorAll('li')].map((li) => li.textContent ?? '');
}

function keydown(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const USERS: EditOption[] = [
  { id: 'u1', label: 'Alice' },
  { id: 'u2', label: 'Bob' },
  { id: 'u3', label: 'Beth' },
];

beforeEach(() => {
  vi.useFakeTimers();
});

describe('createCombobox (single-select)', () => {
  it('loads and renders options on focus, with the special row pinned', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    createCombobox({ input, list, specialRow: { id: '', label: 'None' }, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    await settle();

    expect(rowLabels(list)).toEqual(['None', 'Alice', 'Bob', 'Beth']);
    expect(list.hidden).toBe(false);
  });

  it('filters by typed text and selecting a row sets the value', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const box = createCombobox({ input, list, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    input.value = 'be';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(rowLabels(list)).toEqual(['Beth']);

    const beth = [...list.querySelectorAll('li')].find((li) => li.textContent === 'Beth')!;
    beth.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(box.getValue()).toBe('u3');
    expect(input.value).toBe('Beth');
    expect(list.hidden).toBe(true);
  });

  it('only shows the special row when the query is a prefix of its label', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    createCombobox({ input, list, specialRow: { id: '', label: 'None' }, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(rowLabels(list)).toEqual(['Alice']);
  });

  it('resolveValue looks up the label from loaded options', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const load = vi.fn(async () => USERS);
    const box = createCombobox({ input, list, localFilter: true, load });

    await box.resolveValue('u3');

    expect(box.getValue()).toBe('u3');
    expect(input.value).toBe('Beth');
  });

  it('resolveValue falls back to the id when no option matches', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const box = createCombobox({ input, list, load: async () => USERS });

    await box.resolveValue('FP-6449');

    expect(box.getValue()).toBe('FP-6449');
    expect(input.value).toBe('FP-6449');
  });

  it('resolveValue with an empty id clears the field', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const box = createCombobox({ input, list, load: async () => USERS });

    await box.resolveValue('');

    expect(box.getValue()).toBe('');
    expect(input.value).toBe('');
  });

  it('fetches once and filters locally when localFilter is set', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const load = vi.fn(async () => USERS);
    createCombobox({ input, list, localFilter: true, load });

    input.dispatchEvent(new Event('focus'));
    await settle();
    input.value = 'bo';
    input.dispatchEvent(new Event('input'));
    await settle();

    expect(rowLabels(list)).toEqual(['Bob']);
    expect(load).toHaveBeenCalledTimes(1); // only the initial empty-query fetch
  });
});

describe('createCombobox keyboard navigation', () => {
  it('arrow keys highlight and Enter commits the active row', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    const box = createCombobox({ input, list, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    await settle();
    keydown(input, 'ArrowDown'); // Alice
    keydown(input, 'ArrowDown'); // Bob
    keydown(input, 'Enter');

    expect(box.getValue()).toBe('u2');
    expect(input.value).toBe('Bob');
  });

  it('Escape closes the dropdown', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    createCombobox({ input, list, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    await settle();
    expect(list.hidden).toBe(false);
    keydown(input, 'Escape');
    expect(list.hidden).toBe(true);
  });
});

describe('createCombobox focus/blur race', () => {
  it('does not reopen the dropdown when focus is lost mid-load', async () => {
    const { input, list } = setup('<input /><ul></ul>');
    createCombobox({ input, list, load: async () => USERS });

    input.dispatchEvent(new Event('focus'));
    // Blur before the debounced load fires.
    input.dispatchEvent(new Event('blur'));
    await settle();

    expect(list.hidden).toBe(true);
  });
});

describe('createCombobox (multi-select labels)', () => {
  it('adds chips, filters selected out, and removes on chip click', async () => {
    const { input, list, chips } = setup('<div class="chips"></div><input /><ul></ul>');
    const box = createCombobox({
      input,
      list,
      chips,
      mode: 'multi',
      freeText: true,
      localFilter: true,
      load: async () => [
        { id: 'backend', label: 'backend' },
        { id: 'frontend', label: 'frontend' },
      ],
    });

    input.dispatchEvent(new Event('focus'));
    await settle();
    // Pick "backend".
    [...list.querySelectorAll('li')]
      .find((li) => li.textContent === 'backend')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(box.getValues()).toEqual(['backend']);
    expect(chips!.querySelectorAll('.chip').length).toBe(1);

    // Already-selected label is filtered out of subsequent results.
    input.dispatchEvent(new Event('focus'));
    await settle();
    expect(rowLabels(list)).toEqual(['frontend']);

    // Remove the chip.
    chips!.querySelector('button')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    expect(box.getValues()).toEqual([]);
  });

  it('adds a free-text value on Enter when nothing is highlighted', async () => {
    const { input, list, chips } = setup('<div class="chips"></div><input /><ul></ul>');
    const box = createCombobox({
      input,
      list,
      chips,
      mode: 'multi',
      freeText: true,
      load: async () => [],
    });

    input.value = 'tech-debt';
    keydown(input, 'Enter');
    expect(box.getValues()).toEqual(['tech-debt']);
    expect(input.value).toBe('');
  });
});
