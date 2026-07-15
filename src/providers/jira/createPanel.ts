import { escapeHtml } from '../github/render';

export interface CreatePanelData {
  projectKeys: string[];
  issueTypes: string[];
  summary: string;
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
  const projectOptions = optionList(data.projectKeys);
  const typeOptions = optionList(data.issueTypes, data.issueTypes[0]);
  const projectField = data.projectKeys.length
    ? `<select data-create="project">${projectOptions}</select>`
    : `<input type="text" data-create="project" placeholder="Project key (e.g. ABC)" />`;

  return `
<div class="header">
  <h1>Create Jira ticket</h1>
</div>
<p class="meta">From a TODO comment. Fill in the details and create the issue.</p>

<div class="edit-body">
  <div class="edit-row">
    <label>Project</label>
    ${projectField}
  </div>
  <div class="edit-row">
    <label>Type</label>
    <select data-create="type">${typeOptions}</select>
  </div>
  <div class="edit-row" style="align-items: flex-start;">
    <label>Summary</label>
    <textarea data-create="summary" style="min-height: 60px;">${escapeHtml(data.summary)}</textarea>
  </div>
  <div class="edit-row">
    <label></label>
    <button data-action="create-issue">Create issue</button>
    <span class="status-msg" data-status-for="create"></span>
  </div>
</div>`;
}
