import type {
  InboundMessage,
  OutboundMessage,
  JiraTicketTemplate as JiraTemplate,
} from '../src/core/webviewProtocol';
import type { EditOption } from '../src/core/types';
import { createCombobox } from './combobox';

// VS Code webview API, injected at runtime.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

// A request is an inbound message minus the requestId (added here). Uses a
// distributive conditional so each union member keeps its own fields.
type OmitDistributive<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = OmitDistributive<InboundMessage, 'requestId'>;

// Apply a template value to a field. For a <select>, only select it when the
// option already exists (setting an absent value silently no-ops, so skip it and
// leave the current selection). A free-text <input> accepts any value.
function setFieldValue(el: HTMLInputElement | HTMLSelectElement | null, value: string): void {
  if (!el) return;
  if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === value)) {
    return;
  }
  el.value = value;
}

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
    kind: 'createAssignee' | 'epic' | 'label',
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
    const mode = assigneeInput.dataset.assignMode || 'single';
    const assign = async (option: EditOption): Promise<void> => {
      const id = option.id;
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
    createCombobox({
      input: assigneeInput,
      list: assigneeList,
      localFilter: true,
      specialRow: { id: '', label: 'Unassigned' },
      revertOnBlur: true,
      load: (q) => requestOptions('assignee', q),
      onSelect: (option) => void assign(option),
      onError: (e) => setStatus(status, errMsg(e), 'err'),
    });
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

    // Guard the create-form option feeds: no project → no search.
    const createLoad =
      (kind: 'createAssignee' | 'epic' | 'label') =>
      (q: string): Promise<EditOption[]> => {
        if (!currentProject()) {
          setStatus(status, 'Select a project first', 'err');
          return Promise.resolve([]);
        }
        return requestCreateOptions(kind, currentProject(), q);
      };

    // Assignee: server-searched per keystroke. Epic: fetched once then filtered
    // locally (JQL can't partial-match keys). Both single-select with a "None".
    const createAssigneeInput = document.querySelector<HTMLInputElement>('[data-create="assignee"]');
    const createAssigneeList = document.querySelector<HTMLUListElement>(
      '[data-combobox-list="assignee"]',
    );
    const assigneeBox =
      createAssigneeInput && createAssigneeList
        ? createCombobox({
            input: createAssigneeInput,
            list: createAssigneeList,
            specialRow: { id: '', label: 'None' },
            load: createLoad('createAssignee'),
            onError: (e) => setStatus(status, errMsg(e), 'err'),
          })
        : undefined;

    const parentInput = document.querySelector<HTMLInputElement>('[data-create="parent"]');
    const parentList = document.querySelector<HTMLUListElement>('[data-combobox-list="parent"]');
    const parentBox =
      parentInput && parentList
        ? createCombobox({
            input: parentInput,
            list: parentList,
            localFilter: true,
            specialRow: { id: '', label: 'None' },
            load: createLoad('epic'),
            onError: (e) => setStatus(status, errMsg(e), 'err'),
          })
        : undefined;

    // Labels: multi-select with chips, free-text allowed. Short/curated lists
    // also get clickable toggle buttons for every option (data-label-toggle).
    const labelsInput = document.querySelector<HTMLInputElement>('[data-create="labels"]');
    const labelsList = document.querySelector<HTMLUListElement>('[data-combobox-list="labels"]');
    const labelsChips = document.querySelector<HTMLDivElement>('[data-chips="labels"]');
    const labelToggles = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-label-toggle]'),
    );
    const syncLabelToggles = (values: string[]): void => {
      for (const btn of labelToggles) {
        btn.classList.toggle('selected', values.includes(btn.dataset.labelToggle ?? ''));
      }
    };
    const labelsBox =
      labelsInput && labelsList && labelsChips
        ? createCombobox({
            input: labelsInput,
            list: labelsList,
            chips: labelsChips,
            mode: 'multi',
            freeText: true,
            localFilter: true,
            load: createLoad('label'),
            onChange: syncLabelToggles,
            onError: () => undefined,
          })
        : undefined;
    for (const btn of labelToggles) {
      btn.addEventListener('click', () => labelsBox?.toggleValue(btn.dataset.labelToggle ?? ''));
    }

    // Type: a plain <select> for short/curated lists, or a searchable combobox
    // for the full (often huge) Jira list. The server picks the mode.
    const typeEl = document.querySelector<HTMLSelectElement | HTMLInputElement>(
      '[data-create="type"]',
    );
    const typeIsSelect = typeEl instanceof HTMLSelectElement;
    const typeList = document.querySelector<HTMLUListElement>('[data-combobox-list="type"]');
    const typesRaw = document.querySelector('[data-issue-types]')?.textContent;
    const issueTypes: string[] = typesRaw ? JSON.parse(typesRaw) : [];
    const typeBox =
      !typeIsSelect && typeEl && typeList
        ? createCombobox({
            input: typeEl,
            list: typeList,
            localFilter: true,
            revertOnBlur: true,
            load: () => Promise.resolve(issueTypes.map((t) => ({ id: t, label: t }))),
          })
        : undefined;
    // Combobox has no default option element, so seed it with the first type.
    if (typeBox && issueTypes[0]) typeBox.setValue(issueTypes[0], issueTypes[0]);

    const getType = (): string => (typeIsSelect ? (typeEl?.value ?? '') : (typeBox?.getValue() ?? ''));
    const setType = (v: string): void => {
      if (typeIsSelect) setFieldValue(typeEl, v);
      else typeBox?.setValue(v, v);
    };

    const getAssignee = (): string => assigneeBox?.getValue() ?? '';
    const getParent = (): string => parentBox?.getValue() ?? '';
    const getLabels = (): string[] => labelsBox?.getValues() ?? [];

    // Template picker: prefill fields from the chosen saved template. Priority
    // options are rendered server-side (instance-wide), so we just select them.
    const templateEl = document.querySelector<HTMLSelectElement>('[data-create="template"]');
    const templatesRaw = document.querySelector('[data-templates]')?.textContent;
    const templates: JiraTemplate[] = templatesRaw ? JSON.parse(templatesRaw) : [];

    const applyTemplate = (t: JiraTemplate | undefined): void => {
      if (!t) return;
      if (t.projectKey) setFieldValue(projectEl, t.projectKey);
      if (t.issueType) setType(t.issueType);
      if (t.priorityId) setFieldValue(priorityEl, t.priorityId);
      if (t.dueDate && dueDateEl) dueDateEl.value = t.dueDate;
      if (t.parentKey) parentBox?.setValue(t.parentKey, t.parentKey);
      if (t.assigneeAccountId) assigneeBox?.setValue(t.assigneeAccountId, t.assigneeAccountId);
      if (t.labels) labelsBox?.setValues(t.labels);
    };

    templateEl?.addEventListener('change', () => {
      applyTemplate(templates[Number(templateEl.value)]);
    });

    // Auto-apply the template the extension pre-selected (chosen by the quick
    // fix's issue type).
    const preselect = Number(templateEl?.dataset.preselect ?? -1);
    if (preselect >= 0 && templateEl) {
      templateEl.value = String(preselect);
      applyTemplate(templates[preselect]);
    }

    createBtn.addEventListener('click', async () => {
      const projectKey = currentProject();
      const issueType = getType();
      const summary = summaryEl?.value.trim() ?? '';
      if (!projectKey) {
        setStatus(status, 'Project key is required', 'err');
        return;
      }
      if (!issueType) {
        setStatus(status, 'Type is required', 'err');
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
