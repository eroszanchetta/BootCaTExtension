import { validateCorpusOptions } from './corpus-options.js';
import { DEFUDDLE_AVAILABLE } from './defuddle-loader.js';
import { SETTING_FIELDS, DEFAULT_SETTINGS } from './settings.js';
import { getExtensionAPI } from './extension-api.js';
const ext = getExtensionAPI(), dialog = document.getElementById('settings-dialog');
const form = document.getElementById('settings-form'), status = document.getElementById('settings-status');
const trigger = document.getElementById('open-settings'), cancel = document.getElementById('settings-cancel');
const save = document.getElementById('settings-save'), reset = document.getElementById('settings-reset');
let revision, loading = false, saving = false, request = 0;
const inputs = new Map();
for (const field of SETTING_FIELDS) {
  const row = document.createElement('div'); row.className = 'setting-field';
  const label = document.createElement('label'); label.htmlFor = 'setting-' + field.key;
  label.textContent = field.label + (field.unit ? ` (${field.unit})` : '');
  const input = document.createElement(field.options ? 'select' : 'input'); input.id = label.htmlFor; input.name = field.key;
  input.required = !field.optional;
  if (field.options) {
    for (const choice of field.options) {
      const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; input.append(option);
    }
  } else { input.type = 'number'; input.min = '1'; input.max = String(field.max); input.step = '1'; }
  const help = document.createElement('p'); help.id = input.id + '-help'; help.className = 'hint';
  help.textContent = `Default: ${field.options?.find(option => option.value === field.initial)?.label || (field.initial === null ? 'No limit' : field.initial.toLocaleString())}${field.unit ? ' ' + field.unit : ''}. ${field.help || ''}`;
  const warning = document.createElement('p'); warning.id = input.id + '-warning'; warning.className = 'setting-warning'; warning.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', help.id + ' ' + warning.id);
  input.addEventListener('input', () => { warning.textContent = !field.options && Number(input.value) > field.initial ? (field.warning || '') : ''; status.textContent = ''; });
  row.append(label, input, help, warning);
  document.getElementById(field.advanced ? 'settings-advanced-fields' : 'settings-main-fields').append(row);
  inputs.set(field.key, { input, warning });
}
function populate(values) {
  for (const field of SETTING_FIELDS) {
    const { input, warning } = inputs.get(field.key); input.value = values[field.key] ?? '';
    warning.textContent = !field.options && values[field.key] > field.initial ? (field.warning || '') : '';
  }
}
function controls() {
  for (const { input } of inputs.values()) input.disabled = loading || saving;
  projectControls();
  save.disabled = reset.disabled = loading || saving || revision === undefined;
  cancel.disabled = saving;
  dialog.setAttribute('aria-busy', String(loading || saving));
}
trigger.addEventListener('click', async () => {
  if (dialog.open) return;
  const token = ++request; revision = undefined; loading = true; status.textContent = 'Loading settings…';
  document.getElementById('settings-advanced').open = false;
  populate(DEFAULT_SETTINGS); dialog.showModal(); controls(); cancel.focus({ preventScroll: true }); dialog.scrollTop = 0; projectId = null; projectStatus.textContent = 'Loading project settings…';
  try {
    const result = await ext.runtime.sendMessage({ type: 'get-settings' });
    if (token !== request || !dialog.open) return;
    if (!result.ok) throw new Error(result.error || 'Could not load settings.');
    revision = result.settings.revision; populate(result.settings.values); status.textContent = '';
    await loadProjectOptions(token);
  } catch (error) { if (token === request) status.textContent = error.message; }
  finally { if (token === request) { loading = false; controls(); } }
});
function close() { if (saving) return; request++; dialog.close(); trigger.focus(); }
cancel.addEventListener('click', close);
dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
reset.addEventListener('click', () => { populate(DEFAULT_SETTINGS); status.textContent = 'Defaults restored in this dialog. Choose Save settings to apply them.'; });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (loading || saving || revision === undefined || !form.reportValidity()) return;
  const values = Object.fromEntries([...inputs].map(([key, { input }]) => [key, SETTING_FIELDS.find(field => field.key === key).options ? input.value : (input.value === '' && SETTING_FIELDS.find(field => field.key === key).optional ? null : Number(input.value))]));
  saving = true; controls(); status.textContent = 'Saving settings…';
  try {
    const result = await ext.runtime.sendMessage({ type: 'save-settings', values, revision });
    if (!result.ok) throw new Error(result.error || 'Could not save settings.');
    saving = false; close();
  } catch (error) { status.textContent = error.message; }
  finally { saving = false; controls(); }
});

const projectForm = document.getElementById('project-corpus-settings-form');
const projectStatus = document.getElementById('project-corpus-settings-status');
const projectSave = document.getElementById('project-corpus-settings-save'), projectDefaults = document.getElementById('project-corpus-settings-defaults');
const projectMinimum = document.getElementById('project-minimum-characters'), projectMaximum = document.getElementById('project-maximum-characters'), extractor = document.getElementById('extractor');
let projectId = null, projectRevision = 0;
function projectControls() {
  for (const node of [projectSave, projectDefaults, projectMinimum, projectMaximum, extractor]) node.disabled = loading || saving || !projectId;
  extractor.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
  inputs.get('defaultExtractor').input.querySelector('option[value="defuddle"]').disabled = !DEFUDDLE_AVAILABLE;
}
async function loadProjectOptions(token) {
  const result = await ext.runtime.sendMessage({ type: 'get-project-corpus-options' });
  if (token !== request || !dialog.open) return;
  if (!result.ok) throw new Error(result.error || 'Could not load project settings.');
  projectId = result.projectId || null; projectRevision = result.revision || 0;
  const values = validateCorpusOptions(result.options);
  projectMinimum.value = values.minimumCharacters ?? ''; projectMaximum.value = values.maximumCharacters ?? ''; extractor.value = values.extractor;
  projectStatus.textContent = projectId ? '' : 'Create or open a project to change its settings.';
}
function projectValues() {
  return validateCorpusOptions({ extractor: extractor.value, minimumCharacters: projectMinimum.value === '' ? null : Number(projectMinimum.value), maximumCharacters: projectMaximum.value === '' ? null : Number(projectMaximum.value) });
}
async function saveProjectOptions(asDefaults) {
  if (loading || saving || !projectId || !projectForm.reportValidity()) return;
  let values;
  try { values = projectValues(); } catch (error) { projectStatus.textContent = error.message; return; }
  saving = true; controls(); projectStatus.textContent = 'Saving…';
  try {
    const result = await ext.runtime.sendMessage({ type: asDefaults ? 'set-default-corpus-options' : 'save-project-corpus-options', projectId, values, revision: projectRevision });
    if (!result.ok) throw new Error(result.error || 'Could not save project settings.');
    if (asDefaults) {
      revision = result.settings.revision;
      for (const key of ['defaultExtractor', 'defaultMinimumCharacters', 'defaultMaximumCharacters']) inputs.get(key).input.value = result.settings.values[key] ?? '';
      projectStatus.textContent = 'Defaults saved for new projects.';
    } else { projectRevision = result.revision; projectStatus.textContent = 'Project settings saved.'; }
  } catch (error) { projectStatus.textContent = error.message; }
  finally { saving = false; controls(); }
}
projectForm.addEventListener('submit', event => { event.preventDefault(); saveProjectOptions(false); });
projectDefaults.addEventListener('click', () => saveProjectOptions(true));
