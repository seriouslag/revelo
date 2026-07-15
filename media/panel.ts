import type { InboundMessage, OutboundMessage } from '../src/core/webviewProtocol';
import type { EditOption } from '../src/core/types';

// VS Code webview API, injected at runtime.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

// A request is an inbound message minus the requestId (added here). Uses a
// distributive conditional so each union member keeps its own fields.
type OmitDistributive<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = OmitDistributive<InboundMessage, 'requestId'>;

(function () {
  const vscode = acquireVsCodeApi();
  let seq = 0;
  const pending = new Map<
    string,
    { resolve: (v: OutboundMessage) => void; reject: (e: Error) => void }
  >();

  function request(message: RequestBody): Promise<OutboundMessage> {
    const requestId = `r${seq++}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      // VS Code's webview postMessage takes no targetOrigin (not DOM postMessage).
      // oxlint-disable-next-line require-post-message-target-origin
      vscode.postMessage({ ...message, requestId });
    });
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as OutboundMessage & { requestId?: string };
    const entry = msg && msg.requestId ? pending.get(msg.requestId) : undefined;
    if (!entry) return;
    pending.delete(msg.requestId!);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  });

  async function requestOptions(
    kind: 'transition' | 'assignee' | 'label',
    query: string,
  ): Promise<EditOption[]> {
    const res = await request({ type: 'requestOptions', kind, query });
    return res.type === 'options' ? res.options : [];
  }

  async function requestCreateOptions(
    kind: 'priority' | 'createAssignee' | 'epic' | 'label',
    projectKey: string,
    query: string,
  ): Promise<EditOption[]> {
    const res = await request({ type: 'createOptions', kind, projectKey, query });
    return res.type === 'options' ? res.options : [];
  }

  function setStatus(el: Element | null, text: string, kind?: 'ok' | 'err'): void {
    if (!el) return;
    el.textContent = text;
    el.className = 'status-msg' + (kind ? ' ' + kind : '');
  }

  function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  // --- Status transition dropdown (options preloaded on open) ---
  const statusSelect = document.querySelector<HTMLSelectElement>('[data-edit="transition"]');
  if (statusSelect) {
    const status = document.querySelector('[data-status-for="transition"]');
    // Preload transitions so the list is populated before the user opens it.
    requestOptions('transition', '')
      .then((options) => {
        const current = statusSelect.value;
        for (const opt of options) {
          const o = document.createElement('option');
          o.value = opt.id;
          o.textContent = opt.label;
          statusSelect.appendChild(o);
        }
        statusSelect.value = current;
      })
      .catch((e) => setStatus(status, errMsg(e), 'err'));

    statusSelect.addEventListener('change', async () => {
      const transitionId = statusSelect.value;
      if (!transitionId) return;
      setStatus(status, 'Updating…');
      statusSelect.disabled = true;
      try {
        await request({ type: 'applyEdit', action: { type: 'transition', transitionId } });
        setStatus(status, 'Updated ✓', 'ok');
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
      } finally {
        statusSelect.disabled = false;
      }
    });
  }

  // --- Assignee combobox (type to filter, click/enter to assign) ---
  const assigneeInput = document.querySelector<HTMLInputElement>('[data-edit="assignee"]');
  const assigneeList = document.querySelector<HTMLUListElement>('[data-combobox-list]');
  if (assigneeInput && assigneeList) {
    const status = document.querySelector('[data-status-for="assignee"]');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let items: EditOption[] = [];
    let activeIdx = -1;
    // The last committed assignee text, restored when the user cancels editing.
    let committed = assigneeInput.value;

    const close = (): void => {
      assigneeList.hidden = true;
      activeIdx = -1;
    };
    const cancel = (): void => {
      close();
      assigneeInput.value = committed;
    };
    const mode = assigneeInput.dataset.assignMode || 'single';
    const assign = async (id: string, label: string): Promise<void> => {
      close();
      assigneeInput.value = id ? label : '';
      committed = assigneeInput.value;
      setStatus(status, 'Updating…');
      // Jira assigns a single accountId (null = unassign); GitHub replaces the
      // assignee list with [login] (or [] for unassigned).
      const action =
        mode === 'list'
          ? ({ type: 'assignees', logins: id ? [id] : [] } as const)
          : ({ type: 'assign', accountId: id || null } as const);
      try {
        await request({ type: 'applyEdit', action });
        setStatus(status, 'Updated ✓', 'ok');
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
      }
    };
    const renderList = (): void => {
      assigneeList.innerHTML = '';
      const q = assigneeInput.value.trim().toLowerCase();
      const matches = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
      const rows: EditOption[] = [];
      if (!q || 'unassigned'.includes(q)) {
        rows.push({ id: '', label: 'Unassigned' });
      }
      rows.push(...matches);
      rows.forEach((row, i) => {
        const li = document.createElement('li');
        li.textContent = row.label;
        li.dataset.id = row.id;
        if (i === activeIdx) li.classList.add('active');
        li.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          void assign(row.id, row.label);
        });
        assigneeList.appendChild(li);
      });
      assigneeList.hidden = false;
    };

    assigneeInput.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          items = await requestOptions('assignee', assigneeInput.value.trim());
          activeIdx = -1;
          renderList();
        } catch (e) {
          setStatus(status, errMsg(e), 'err');
        }
      }, 250);
    });
    assigneeInput.addEventListener('keydown', (ev) => {
      // Escape reverts even when the dropdown is already closed.
      if (ev.key === 'Escape') {
        cancel();
        assigneeInput.blur();
        return;
      }
      if (assigneeList.hidden) return;
      const rows = assigneeList.querySelectorAll('li');
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        activeIdx = Math.min(activeIdx + 1, rows.length - 1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
      } else if (ev.key === 'Enter' && activeIdx >= 0) {
        ev.preventDefault();
        const li = rows[activeIdx] as HTMLLIElement;
        void assign(li.dataset.id ?? '', li.textContent ?? '');
        return;
      } else {
        return;
      }
      rows.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    });
    // On blur, revert any uncommitted typing to the last committed value.
    assigneeInput.addEventListener('blur', () => setTimeout(cancel, 120));
  }

  // --- State toggle (GitHub close / reopen; Sentry resolve/unresolve) ---
  const stateBtn = document.querySelector<HTMLButtonElement>('[data-action="toggle-state"]');
  if (stateBtn) {
    const status = document.querySelector('[data-status-for="state"]');
    stateBtn.addEventListener('click', async () => {
      const current = stateBtn.dataset.state;
      const noun = stateBtn.dataset.noun || 'issue';
      const next = current === 'open' ? 'closed' : 'open';
      setStatus(status, 'Updating…');
      stateBtn.disabled = true;
      try {
        await request({ type: 'applyEdit', action: { type: 'state', state: next } });
        stateBtn.dataset.state = next;
        stateBtn.textContent = next === 'open' ? `Close ${noun}` : `Reopen ${noun}`;
        setStatus(status, 'Updated ✓', 'ok');
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
      } finally {
        stateBtn.disabled = false;
      }
    });
  }

  // --- Sentry status dropdown (resolve / ignore / unresolve) ---
  const sentryStatus = document.querySelector<HTMLSelectElement>('[data-edit="sentry-status"]');
  if (sentryStatus) {
    const status = document.querySelector('[data-status-for="sentry-status"]');
    sentryStatus.addEventListener('change', async () => {
      const value = sentryStatus.value as 'resolved' | 'ignored' | 'unresolved';
      setStatus(status, 'Updating…');
      sentryStatus.disabled = true;
      try {
        await request({ type: 'applyEdit', action: { type: 'sentryStatus', status: value } });
        setStatus(status, 'Updated ✓', 'ok');
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
      } finally {
        sentryStatus.disabled = false;
      }
    });
  }

  // --- Labels editor (checklist of repo labels) ---
  const labelsBtn = document.querySelector<HTMLButtonElement>('[data-action="edit-labels"]');
  const labelEditor = document.querySelector<HTMLDivElement>('[data-label-editor]');
  if (labelsBtn && labelEditor) {
    const status = document.querySelector('[data-status-for="labels"]');
    let loaded = false;
    const current = new Set<string>(JSON.parse(labelsBtn.dataset.current || '[]') as string[]);

    labelsBtn.addEventListener('click', async () => {
      if (labelEditor.hidden === false) {
        labelEditor.hidden = true;
        return;
      }
      if (!loaded) {
        try {
          const options = await requestOptions('label', '');
          labelEditor.innerHTML = '';

          const search = document.createElement('input');
          search.type = 'text';
          search.className = 'label-search';
          search.placeholder = 'Search labels…';
          search.autocomplete = 'off';
          search.spellcheck = false;
          labelEditor.appendChild(search);

          const list = document.createElement('div');
          list.className = 'label-list';
          labelEditor.appendChild(list);

          for (const opt of options) {
            const wrap = document.createElement('label');
            wrap.className = 'label-check';
            wrap.dataset.label = opt.label.toLowerCase();
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = opt.id;
            cb.checked = current.has(opt.id);
            const span = document.createElement('span');
            span.textContent = opt.label;
            wrap.appendChild(cb);
            wrap.appendChild(span);
            list.appendChild(wrap);
          }

          search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            for (const wrap of list.querySelectorAll<HTMLElement>('.label-check')) {
              wrap.hidden = q !== '' && !(wrap.dataset.label ?? '').includes(q);
            }
          });

          const apply = document.createElement('button');
          apply.textContent = 'Apply labels';
          apply.addEventListener('click', async () => {
            const labels = [
              ...labelEditor.querySelectorAll<HTMLInputElement>('input:checked'),
            ].map((c) => c.value);
            setStatus(status, 'Updating…');
            apply.disabled = true;
            try {
              await request({ type: 'applyEdit', action: { type: 'labels', labels } });
              setStatus(status, 'Updated ✓', 'ok');
            } catch (e) {
              setStatus(status, errMsg(e), 'err');
            } finally {
              apply.disabled = false;
            }
          });
          labelEditor.appendChild(apply);
          loaded = true;
        } catch (e) {
          setStatus(status, errMsg(e), 'err');
          return;
        }
      }
      labelEditor.hidden = false;
    });
  }

  // --- Description editor with dirty state ---
  const descArea = document.querySelector<HTMLTextAreaElement>('[data-edit="description"]');
  const saveBtn = document.querySelector<HTMLButtonElement>('[data-action="save-description"]');
  if (descArea && saveBtn) {
    const status = document.querySelector('[data-status-for="description"]');
    const original = descArea.value;
    saveBtn.disabled = descArea.value === original;
    descArea.addEventListener('input', () => {
      saveBtn.disabled = false;
      setStatus(status, '');
    });
    saveBtn.addEventListener('click', async () => {
      setStatus(status, 'Saving…');
      saveBtn.disabled = true;
      try {
        await request({ type: 'applyEdit', action: { type: 'description', text: descArea.value } });
        setStatus(status, 'Saved ✓', 'ok');
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
        saveBtn.disabled = false;
      }
    });
  }

  // --- Create Jira issue from TODO ---
  const createBtn = document.querySelector<HTMLButtonElement>('[data-action="create-issue"]');
  if (createBtn) {
    const status = document.querySelector('[data-status-for="create"]');
    const projectEl = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      '[data-create="project"]',
    );
    const typeEl = document.querySelector<HTMLSelectElement>('[data-create="type"]');
    const summaryEl = document.querySelector<HTMLTextAreaElement>('[data-create="summary"]');
    const descEl = document.querySelector<HTMLTextAreaElement>('[data-create="description"]');
    const priorityEl = document.querySelector<HTMLSelectElement>('[data-create="priority"]');
    const dueDateEl = document.querySelector<HTMLInputElement>('[data-create="dueDate"]');

    const currentProject = (): string => projectEl?.value.trim() ?? '';

    // Auto-grow the summary textarea to fit its content.
    if (summaryEl) {
      const autogrow = (): void => {
        summaryEl.style.height = 'auto';
        summaryEl.style.height = `${summaryEl.scrollHeight}px`;
      };
      summaryEl.addEventListener('input', autogrow);
      // Enter submits rather than adding a newline (summary is single-line).
      summaryEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          createBtn.click();
        }
      });
      setTimeout(autogrow, 0);
    }

    // A search combobox that resolves a selected id (assignee, epic parent).
    // localFilter: fetch options once and filter client-side (epics — JQL can't
    // do partial-key matching). Otherwise search the server per keystroke.
    function wireCombobox(
      field: 'createAssignee' | 'epic',
      inputSel: string,
      listSel: string,
      localFilter: boolean,
    ): () => string {
      const input = document.querySelector<HTMLInputElement>(inputSel);
      const list = document.querySelector<HTMLUListElement>(listSel);
      let selectedId = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cache: EditOption[] | undefined;
      let activeIdx = -1;
      let focused = false;
      if (!input || !list) return () => selectedId;

      const close = (): void => {
        if (timer) clearTimeout(timer);
        list.hidden = true;
        activeIdx = -1;
      };
      const commit = (row: EditOption): void => {
        selectedId = row.id;
        input.value = row.id ? row.label : '';
        close();
      };
      const highlight = (): void => {
        list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx));
      };
      const render = (items: EditOption[]): void => {
        list.innerHTML = '';
        activeIdx = -1;
        const rows: EditOption[] = [{ id: '', label: 'None' }, ...items.slice(0, 50)];
        for (const row of rows) {
          const li = document.createElement('li');
          li.textContent = row.label;
          li.dataset.id = row.id;
          li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            commit(row);
          });
          list.appendChild(li);
        }
        list.hidden = false;
      };
      const search = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          if (!currentProject()) {
            setStatus(status, 'Select a project first', 'err');
            return;
          }
          const q = input.value.trim();
          try {
            if (localFilter) {
              if (!cache) cache = await requestCreateOptions(field, currentProject(), '');
              const ql = q.toLowerCase();
              // The field may have lost focus while the fetch was in flight.
              if (!focused) return;
              render(ql ? cache.filter((o) => o.label.toLowerCase().includes(ql)) : cache);
            } else {
              const options = await requestCreateOptions(field, currentProject(), q);
              if (!focused) return;
              render(options);
            }
          } catch (e) {
            setStatus(status, errMsg(e), 'err');
          }
        }, 250);
      };
      input.addEventListener('input', () => {
        selectedId = '';
        search();
      });
      // Show results as soon as the field is focused, even when empty.
      input.addEventListener('focus', () => {
        focused = true;
        search();
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          close();
          return;
        }
        if (list.hidden) return;
        const rows = list.querySelectorAll<HTMLLIElement>('li');
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          activeIdx = Math.min(activeIdx + 1, rows.length - 1);
          highlight();
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          activeIdx = Math.max(activeIdx - 1, 0);
          highlight();
        } else if (ev.key === 'Enter' && activeIdx >= 0) {
          ev.preventDefault();
          const li = rows[activeIdx];
          commit({ id: li.dataset.id ?? '', label: li.textContent ?? '' });
        }
      });
      input.addEventListener('blur', () => {
        focused = false;
        setTimeout(close, 120);
      });
      return () => selectedId;
    }

    const getAssignee = wireCombobox(
      'createAssignee',
      '[data-create="assignee"]',
      '[data-combobox-list="assignee"]',
      false,
    );
    const getParent = wireCombobox(
      'epic',
      '[data-create="parent"]',
      '[data-combobox-list="parent"]',
      true,
    );

    // Multi-select labels combobox: fetch once, filter locally, free-text add,
    // selected labels shown as removable chips.
    const getLabels = ((): (() => string[]) => {
      const input = document.querySelector<HTMLInputElement>('[data-create="labels"]');
      const list = document.querySelector<HTMLUListElement>('[data-combobox-list="labels"]');
      const chipsEl = document.querySelector<HTMLDivElement>('[data-chips="labels"]');
      const selected: string[] = [];
      if (!input || !list || !chipsEl) return () => selected;

      let all: string[] = [];
      let loaded = false;
      let activeIdx = -1;
      let focused = false;

      const renderChips = (): void => {
        chipsEl.innerHTML = '';
        for (const label of selected) {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = label;
          const x = document.createElement('button');
          x.textContent = '×';
          x.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            selected.splice(selected.indexOf(label), 1);
            renderChips();
          });
          chip.appendChild(x);
          chipsEl.appendChild(chip);
        }
      };
      const add = (label: string): void => {
        const v = label.trim();
        if (v && !selected.includes(v)) selected.push(v);
        input.value = '';
        list.hidden = true;
        renderChips();
      };
      const highlight = (): void => {
        list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx));
      };
      const renderList = (): void => {
        const q = input.value.trim().toLowerCase();
        const matches = all.filter((l) => !selected.includes(l) && l.toLowerCase().includes(q));
        list.innerHTML = '';
        activeIdx = -1;
        for (const label of matches.slice(0, 50)) {
          const li = document.createElement('li');
          li.textContent = label;
          li.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            add(label);
          });
          list.appendChild(li);
        }
        list.hidden = matches.length === 0;
      };
      input.addEventListener('focus', async () => {
        focused = true;
        if (!loaded && currentProject()) {
          try {
            all = (await requestCreateOptions('label', currentProject(), '')).map((o) => o.id);
            loaded = true;
          } catch {
            // Labels are best-effort; free-text still works.
          }
        }
        // The field may have lost focus while labels were loading.
        if (focused) renderList();
      });
      input.addEventListener('input', renderList);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          list.hidden = true;
          activeIdx = -1;
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
          ev.preventDefault();
          // Enter picks the highlighted suggestion, else adds the free-text.
          if (!list.hidden && activeIdx >= 0) {
            add(rows[activeIdx].textContent ?? '');
          } else if (input.value.trim()) {
            add(input.value);
          }
        }
      });
      input.addEventListener('blur', () => {
        focused = false;
        setTimeout(() => (list.hidden = true), 120);
      });
      return () => selected;
    })();

    // Preload priorities into the dropdown.
    if (priorityEl && currentProject()) {
      requestCreateOptions('priority', currentProject(), '')
        .then((options) => {
          for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt.id;
            o.textContent = opt.label;
            priorityEl.appendChild(o);
          }
        })
        .catch(() => undefined);
    }

    createBtn.addEventListener('click', async () => {
      const projectKey = currentProject();
      const issueType = typeEl?.value.trim() ?? '';
      const summary = summaryEl?.value.trim() ?? '';
      if (!projectKey) {
        setStatus(status, 'Project key is required', 'err');
        return;
      }
      if (!summary) {
        setStatus(status, 'Summary is required', 'err');
        return;
      }
      setStatus(status, 'Creating…');
      createBtn.disabled = true;
      try {
        const res = await request({
          type: 'createIssue',
          input: {
            projectKey,
            issueType,
            summary,
            description: descEl?.value.trim() || undefined,
            priorityId: priorityEl?.value || undefined,
            dueDate: dueDateEl?.value || undefined,
            assigneeAccountId: getAssignee() || undefined,
            parentKey: getParent() || undefined,
            labels: getLabels().length ? getLabels() : undefined,
          },
        });
        if (res.type === 'created') {
          setStatus(status, `Created ${res.key} ✓`, 'ok');
        }
      } catch (e) {
        setStatus(status, errMsg(e), 'err');
        createBtn.disabled = false;
      }
    });
  }
})();
