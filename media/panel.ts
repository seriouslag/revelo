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
})();
