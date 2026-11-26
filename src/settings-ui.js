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
  input.required = true;
  if (field.options) {
    for (const choice of field.options) {
      const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; input.append(option);
    }
  } else { input.type = 'number'; input.min = '1'; input.max = String(field.max); input.step = '1'; }
  const help = document.createElement('p'); help.id = input.id + '-help'; help.className = 'hint';
  help.textContent = `Default: ${field.options?.find(option => option.value === field.initial)?.label || field.initial.toLocaleString()}${field.unit ? ' ' + field.unit : ''}. ${field.help || ''}`;
  const warning = document.createElement('p'); warning.id = input.id + '-warning'; warning.className = 'setting-warning'; warning.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', help.id + ' ' + warning.id);
  input.addEventListener('input', () => { warning.textContent = !field.options && Number(input.value) > field.initial ? field.warning : ''; status.textContent = ''; });
  row.append(label, input, help, warning);
  document.getElementById(field.advanced ? 'settings-advanced-fields' : 'settings-main-fields').append(row);
  inputs.set(field.key, { input, warning });
}
function populate(values) {
  for (const field of SETTING_FIELDS) {
    const { input, warning } = inputs.get(field.key); input.value = values[field.key];
    warning.textContent = !field.options && values[field.key] > field.initial ? field.warning : '';
  }
}
function controls() {
  for (const { input } of inputs.values()) input.disabled = loading || saving;
  save.disabled = reset.disabled = loading || saving || revision === undefined;
  cancel.disabled = saving;
  dialog.setAttribute('aria-busy', String(loading || saving));
}
trigger.addEventListener('click', async () => {
  if (dialog.open) return;
  const token = ++request; revision = undefined; loading = true; status.textContent = 'Loading settings…';
  document.getElementById('settings-advanced').open = false;
  populate(DEFAULT_SETTINGS); dialog.showModal(); controls(); cancel.focus({ preventScroll: true }); dialog.scrollTop = 0;
  try {
    const result = await ext.runtime.sendMessage({ type: 'get-settings' });
    if (token !== request || !dialog.open) return;
    if (!result.ok) throw new Error(result.error || 'Could not load settings.');
    revision = result.settings.revision; populate(result.settings.values); status.textContent = '';
  } catch (error) { if (token === request) status.textContent = error.message; }
  finally { if (token === request) { loading = false; controls(); } }
});
function close() { if (saving) return; request++; dialog.close(); trigger.focus(); }
cancel.addEventListener('click', close);
dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
reset.addEventListener('click', () => { populate(DEFAULT_SETTINGS); status.textContent = 'Defaults restored in this dialog. Choose Save settings to apply them.'; });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (loading || saving || revision === undefined || !form.reportValidity()) return;
  const values = Object.fromEntries([...inputs].map(([key, { input }]) => [key, SETTING_FIELDS.find(field => field.key === key).options ? input.value : Number(input.value)]));
  saving = true; controls(); status.textContent = 'Saving settings…';
  try {
    const result = await ext.runtime.sendMessage({ type: 'save-settings', values, revision });
    if (!result.ok) throw new Error(result.error || 'Could not save settings.');
    saving = false; close();
  } catch (error) { status.textContent = error.message; }
  finally { saving = false; controls(); }
});
