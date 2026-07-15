import { escapeHtml } from '../github/render';
import type { JiraPriority, JiraEpic } from './api';
import type { JiraTicketTemplate } from '../../core/webviewProtocol';

export type { JiraTicketTemplate };

export interface CreatePanelData {
  projectKeys: string[];
  issueTypes: string[];
  /** Render Type as a plain dropdown (short/curated list) vs a search combobox. */
  typeAsDropdown: boolean;
  priorities: JiraPriority[];
  labels: string[];
  /** Render Labels as toggle chips (short/curated) vs a search combobox. */
  labelsAsChips: boolean;
  epicsByProject: Record<string, JiraEpic[]>;
  summary: string;
  description: string;
  templates: JiraTicketTemplate[];
  /** Index of the template to auto-apply on open, or -1 for none. */
  preselectTemplateIndex?: number;
  /** Append internal ids to option labels for discovery. */
  debug?: boolean;
}

function optionList(values: string[], selected?: string): string {
  return values
    .map((v) => {
      const sel = v === selected ? ' selected' : '';
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(v)}</option>`;
    })
    .join('');
}

/** Render a loading placeholder shown while create-form options are fetched. */
export function renderCreateLoading(): string {
  return `
<div class="loading-panel">
  <span class="spinner"></span>
  <p class="meta">Loading options from Jira…</p>
</div>`;
}

/** Render the Jira "create issue from TODO" form as panel HTML. */
export function renderCreatePanel(data: CreatePanelData): string {
  const typesJson = JSON.stringify(data.issueTypes).replace(/</g, '\\u003c');
  const priorityOptions = data.priorities
    .map((p) => {
      const label = data.debug ? `${p.name} (id: ${p.id})` : p.name;
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  const projectField = data.projectKeys.length
    ? `<select id="rv-project" data-create="project">${optionList(data.projectKeys)}</select>`
    : `<input id="rv-project" type="text" data-create="project" placeholder="Project key (e.g. ABC)" />`;

  // Short/curated type lists render as a plain dropdown; the full Jira list as a
  // searchable combobox (data-type-mode tells the webview which to wire up).
  const typeField = data.typeAsDropdown
    ? `<select id="rv-type" data-create="type" data-type-mode="select">${optionList(data.issueTypes, data.issueTypes[0])}</select>`
    : `<div class="combobox" data-type-mode="combobox">
      <input id="rv-type" type="text" data-create="type" placeholder="Search issue types…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="type" tabindex="-1" hidden></ul>
    </div>`;

  const labelsJson = JSON.stringify(data.labels).replace(/</g, '\\u003c');
  // Short/curated label lists show every option as a toggle chip up front; the
  // full list stays a search combobox. Both keep the chips + free-text input.
  const labelsField = data.labelsAsChips
    ? `<div class="combobox" data-labels-mode="chips">
      <div class="label-toggles" data-label-toggles>
        ${data.labels.map((l) => `<button type="button" class="label-toggle" data-label-toggle="${escapeHtml(l)}">${escapeHtml(l)}</button>`).join('')}
      </div>
      <div class="chips" data-chips="labels"></div>
      <input id="rv-labels" type="text" data-create="labels" placeholder="Add another label…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="labels" tabindex="-1" hidden></ul>
    </div>`
    : `<div class="combobox" data-labels-mode="combobox">
      <div class="chips" data-chips="labels"></div>
      <input id="rv-labels" type="text" data-create="labels" placeholder="Search or add labels…" autocomplete="off" spellcheck="false" />
      <ul class="combobox-list" data-combobox-list="labels" tabindex="-1" hidden></ul>
    </div>`;

  const preselect = data.preselectTemplateIndex ?? -1;
  // Embed the templates as JSON for the webview to read. Escape "<" so a value
  // containing "</script>" can't break out of the tag.
  const templatesJson = JSON.stringify(data.templates).replace(/</g, '\\u003c');
  const templateField = data.templates.length
    ? `
  <div class="edit-row">
    <label for="rv-template">Template</label>
    <select id="rv-template" data-create="template" data-preselect="${preselect}">
      <option value="">—</option>
      ${data.templates.map((t, i) => `<option value="${i}"${i === preselect ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
    </select>
  </div>`
    : '';

  return `
<div class="header">
  <h1>Revelo: Create Jira ticket</h1>
</div>
<p class="meta">From a TODO comment. Fill in the details and create the issue.</p>
<script type="application/json" data-templates>${templatesJson}</script>

<div class="edit-body">
  ${templateField}
  <div class="edit-row">
    <label for="rv-project">Project</label>
    ${projectField}
  </div>
  <div class="edit-row">
    <label for="rv-type">Type</label>
    ${typeField}
  </div>
  <script type="application/json" data-issue-types>${typesJson}</script>
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
    <select id="rv-priority" data-create="priority"><option value="">—</option>${priorityOptions}</select>
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
    ${labelsField}
  </div>
  <script type="application/json" data-labels>${labelsJson}</script>
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
