import type { EditOption } from '../src/core/types';

export interface ComboboxConfig {
  input: HTMLInputElement;
  list: HTMLUListElement;
  /** Load options for a query. The component debounces calls (250ms). */
  load: (query: string) => Promise<EditOption[]>;
  /**
   * Fetch once with an empty query, then filter by label client-side. Use when
   * the backend can't search (e.g. Jira epics — JQL can't partial-match keys).
   */
  localFilter?: boolean;
  /** A pinned first row (e.g. {id:'',label:'None'}) shown above matches. */
  specialRow?: EditOption;
  mode?: 'single' | 'multi';
  /** Multi only: allow committing arbitrary typed values (e.g. new labels). */
  freeText?: boolean;
  /** Multi only: container element for the selected-value chips. */
  chips?: HTMLElement;
  /** Single only: called when a row is chosen (id '' means the special row). */
  onSelect?: (option: EditOption) => void;
  /** Multi only: called whenever the selected set changes (add/remove). */
  onChange?: (values: string[]) => void;
  /** Restore the last committed input text on blur/escape (edit-in-place). */
  revertOnBlur?: boolean;
  onError?: (e: unknown) => void;
}

export interface ComboboxHandle {
  /** Single: the selected id ('' if none). */
  getValue(): string;
  /** Multi: the selected ids. */
  getValues(): string[];
  /** Single: set the selected value and its displayed label. */
  setValue(id: string, label: string): void;
  /** Multi: replace the selected values. */
  setValues(values: string[]): void;
  /** Multi: add the value if absent, remove it if present. */
  toggleValue(value: string): void;
}

const DEBOUNCE_MS = 250;
const BLUR_CLOSE_MS = 120;

/**
 * A search/select dropdown shared by every panel combobox. Handles debounced
 * loading (or fetch-once-filter-locally), keyboard nav (arrow/enter/escape),
 * an active-row highlight, and a focus/blur race guard so a late-resolving
 * search can't reopen the list after the field lost focus.
 */
export function createCombobox(config: ComboboxConfig): ComboboxHandle {
  const { input, list } = config;
  const multi = config.mode === 'multi';

  let timer: ReturnType<typeof setTimeout> | undefined;
  let cache: EditOption[] | undefined;
  let activeIdx = -1;
  let focused = false;
  let selectedId = '';
  const selected: string[] = [];
  // Last committed input text, restored on cancel when revertOnBlur is set.
  let committed = input.value;

  const close = (): void => {
    if (timer) clearTimeout(timer);
    list.hidden = true;
    activeIdx = -1;
  };

  const highlight = (): void => {
    list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx));
  };

  const renderChips = (): void => {
    // Every multi-mode mutation flows through here, so it's the one spot to
    // notify listeners (e.g. label toggle buttons that mirror the selection).
    config.onChange?.(selected);
    if (!config.chips) return;
    config.chips.innerHTML = '';
    for (const value of selected) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = value;
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        selected.splice(selected.indexOf(value), 1);
        renderChips();
      });
      chip.appendChild(remove);
      config.chips.appendChild(chip);
    }
  };

  const choose = (option: EditOption): void => {
    if (multi) {
      const v = option.label.trim();
      if (v && !selected.includes(v)) selected.push(v);
      input.value = '';
      renderChips();
    } else {
      selectedId = option.id;
      input.value = option.id ? option.label : '';
      committed = input.value;
      config.onSelect?.(option);
    }
    close();
  };

  const render = (items: EditOption[]): void => {
    list.innerHTML = '';
    activeIdx = -1;
    const rows: EditOption[] = [];
    // Show the pinned row (e.g. "Unassigned"/"None") only when the query is
    // empty or is a prefix of its label.
    if (config.specialRow) {
      const q = input.value.trim().toLowerCase();
      if (!q || config.specialRow.label.toLowerCase().includes(q)) {
        rows.push(config.specialRow);
      }
    }
    rows.push(...items.slice(0, 50));
    for (const row of rows) {
      const li = document.createElement('li');
      li.textContent = row.label;
      li.dataset.id = row.id;
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        choose(row);
      });
      list.appendChild(li);
    }
    list.hidden = rows.length === 0;
  };

  const runSearch = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      try {
        let options: EditOption[];
        if (config.localFilter) {
          // Fetch once, then narrow the cached set client-side.
          if (!cache) cache = await config.load('');
          options = cache;
        } else {
          options = await config.load(q);
        }
        // Always refine by the typed text: some backends (e.g. GitHub's
        // assignee list) ignore the query, so a local filter is required and is
        // a harmless no-op when the server already filtered.
        const ql = q.toLowerCase();
        if (ql) options = options.filter((o) => o.label.toLowerCase().includes(ql));
        // Filter out already-selected values in multi mode.
        if (multi) options = options.filter((o) => !selected.includes(o.label));
        // The field may have lost focus while the load was in flight.
        if (!focused) return;
        render(options);
      } catch (e) {
        config.onError?.(e);
      }
    }, DEBOUNCE_MS);
  };

  input.addEventListener('input', () => {
    selectedId = '';
    runSearch();
  });
  input.addEventListener('focus', () => {
    focused = true;
    runSearch();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      close();
      if (config.revertOnBlur) input.value = committed;
      input.blur();
      return;
    }
    const rows = list.querySelectorAll<HTMLLIElement>('li');
    if (ev.key === 'ArrowDown' && !list.hidden) {
      ev.preventDefault();
      activeIdx = Math.min(activeIdx + 1, rows.length - 1);
      highlight();
    } else if (ev.key === 'ArrowUp' && !list.hidden) {
      ev.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      highlight();
    } else if (ev.key === 'Enter') {
      if (!list.hidden && activeIdx >= 0) {
        ev.preventDefault();
        const li = rows[activeIdx];
        choose({ id: li.dataset.id ?? '', label: li.textContent ?? '' });
      } else if (multi && config.freeText && input.value.trim()) {
        ev.preventDefault();
        choose({ id: input.value.trim(), label: input.value.trim() });
      }
    }
  });
  input.addEventListener('blur', () => {
    focused = false;
    setTimeout(() => {
      close();
      if (config.revertOnBlur) input.value = committed;
    }, BLUR_CLOSE_MS);
  });

  return {
    getValue: () => selectedId,
    getValues: () => selected,
    setValue: (id, label) => {
      selectedId = id;
      input.value = id ? label : '';
      committed = input.value;
    },
    setValues: (values) => {
      selected.splice(0, selected.length, ...values);
      input.value = '';
      renderChips();
    },
    toggleValue: (value) => {
      const v = value.trim();
      if (!v) return;
      const i = selected.indexOf(v);
      if (i >= 0) selected.splice(i, 1);
      else selected.push(v);
      renderChips();
    },
  };
}
