import { escapeHtml } from '../github/render';

export interface CreatePanelData {
  projectKeys: string[];
  issueTypes: string[];
  summary: string;
  description: string;
}

function optionList(values: string[], selected?: string): string {
  return values
    .map((v) => {
      const sel = v === selected ? ' selected' : '';
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(v)}</option>`;
    })
    .join('');
}

/** Render the Jira "create issue from TODO" form as panel HTML. */
export function renderCreatePanel(data: CreatePanelData): string {
  const typeOptions = optionList(data.issueTypes, data.issueTypes[0]);
  const projectField = data.projectKeys.length
    ? `<select id="rv-project" data-create="project">${optionList(data.projectKeys)}</select>`
    : `<input id="rv-project" type="text" data-create="project" placeholder="Project key (e.g. ABC)" />`;

  return `
<div class="header">
  <h1>Create Jira ticket</h1>
</div>
<p class="meta">From a TODO comment. Fill in the details and create the issue.</p>

<div class="edit-body">
  <div class="edit-row">
    <label for="rv-project">Project</label>
    ${projectField}
  </div>
  <div class="edit-row">
    <label for="rv-type">Type</label>
    <select id="rv-type" data-create="type">${typeOptions}</select>
  </div>
  <div class="edit-row" style="align-items: flex-start;">
    <label for="rv-summary">Summary</label>
    <textarea id="rv-summary" class="summary-input" data-create="summary" rows="1">${escapeHtml(data.summary)}</textarea>
  </div>
  <div class="edit-row" style="align-items: flex-start;">
    <label for="rv-description">Description</label>
    <textarea id="rv-description" data-create="description">${escapeHtml(data.description)}</textarea>
  </div>
  <div class="edit-row">
    <label for="rv-priority">Priority</label>
    <select id="rv-priority" data-create="priority"><option value="">—</option></select>
  </div>
  <div class="edit-row">
    <label for="rv-assignee">Assignee</label>
    <div class="combobox">
      <input id="rv-assignee" type="text" data-create="assignee" placeholder="Search users…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="assignee" tabindex="-1" hidden></ul>
    </div>
  </div>
  <div class="edit-row">
    <label for="rv-parent">Epic / Parent</label>
    <div class="combobox">
      <input id="rv-parent" type="text" data-create="parent" placeholder="Search epics by name or key…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="parent" tabindex="-1" hidden></ul>
    </div>
  </div>
  <div class="edit-row" style="align-items: flex-start;">
    <label for="rv-labels">Labels</label>
    <div class="combobox">
      <div class="chips" data-chips="labels"></div>
      <input id="rv-labels" type="text" data-create="labels" placeholder="Search or add labels…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="labels" tabindex="-1" hidden></ul>
    </div>
  </div>
  <div class="edit-row">
    <label for="rv-dueDate">Due date</label>
    <input id="rv-dueDate" type="date" data-create="dueDate" />
  </div>
  <div class="edit-row">
    <label></label>
    <button data-action="create-issue">Create issue</button>
    <span class="status-msg" data-status-for="create"></span>
  </div>
</div>`;
}
