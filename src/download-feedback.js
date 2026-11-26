export const DOWNLOAD_FEEDBACK_KEY = 'downloadFeedback';
export const DEFAULT_ACTION_TITLE = 'BootCaT: collect results or open workspace';
const terminal = new Set(['finished', 'stopped', 'interrupted']);
export function feedbackIssues(value) { return value.failed + value.cancelled + value.flagged; }
export function downloadSummary(value) {
  const counts = [`${value.processed} of ${value.total} URLs processed`, `${value.usable} usable text${value.usable === 1 ? '' : 's'}`];
  for (const [key, label] of [['failed', 'failed'], ['cancelled', 'cancelled'], ['flagged', 'language warning'], ['skipped', 'skipped']]) {
    if (value[key]) counts.push(`${value[key]} ${label}${key === 'flagged' && value[key] !== 1 ? 's' : ''}`);
  }
  const heading = value.state === 'running' ? value.phase === 'stopping' ? 'Stopping…' : value.processed === value.total ? 'Finishing…' : `${value.phase === 'extracting' ? 'Extracting text' : 'Downloading'} ${Math.min(value.processed + 1, value.total)} of ${value.total}…`
    : value.state === 'stopped' ? 'Stopped.' : value.state === 'interrupted' ? 'Interrupted. Completed pages remain saved.' : feedbackIssues(value) ? 'Finished with issues.' : 'Finished.';
  return `${heading} ${counts.join(' · ')}.`;
}
export function feedbackAppearance(value) {
  if (!value || value.acknowledged) return { badge: '', title: DEFAULT_ACTION_TITLE, tabTitle: 'BootCaT · Corpus workspace', tone: 'idle' };
  if (value.state === 'running') return { badge: '…', title: `BootCaT: ${downloadSummary(value)}`, tabTitle: `${value.processed}/${value.total} processed · BootCaT`, color: '#007aa6', tone: 'running' };
  const issue = feedbackIssues(value) > 0 || value.state !== 'finished';
  return { badge: value.state === 'stopped' ? 'STOP' : issue ? '!' : '✓', title: `BootCaT: ${downloadSummary(value)}`,
    tabTitle: `${value.state === 'stopped' ? 'Downloads stopped' : value.state === 'interrupted' ? 'Downloads interrupted' : issue ? 'Finished with issues' : 'Downloads finished'} · BootCaT`, color: issue ? '#8a4b00' : '#166534', tone: issue ? 'attention' : 'finished' };
}
function counters(input, total) {
  const fields = ['processed', 'usable', 'failed', 'cancelled', 'flagged', 'skipped'];
  const values = Object.fromEntries(fields.map(key => [key, input[key] ?? 0]));
  for (const value of Object.values(values)) if (!Number.isSafeInteger(value) || value < 0 || value > total) throw new Error('Invalid download progress.');
  if (values.usable + values.failed + values.cancelled + values.skipped !== values.processed || values.flagged > values.usable) throw new Error('Inconsistent download counts.');
  return values;
}
// This browser-local receipt is deliberately separate from portable project data.
// All changes and badge updates share the background's serialization queue.
export function createDownloadFeedback({ ext, getProject, serialize, batchActive = async projectId => {
  if (!globalThis.navigator?.locks?.query) return null;
  return (await navigator.locks.query()).held.some(lock => lock.name === `bootcat:${projectId}:batch`);
} }) {
  let ownerTabId;
  async function paint(value) {
    ownerTabId = value?.ownerTabId;
    const look = feedbackAppearance(value);
    try {
      await ext.action?.setBadgeBackgroundColor?.({ color: look.color || '#007aa6' });
      await ext.action?.setBadgeTextColor?.({ color: '#ffffff' });
      await ext.action?.setBadgeText?.({ text: look.badge });
      await ext.action?.setTitle?.({ title: look.title });
    } catch { /* Badge availability must never change download outcomes. */ }
  }
  async function read() {
    let value = (await ext.storage.local.get(DOWNLOAD_FEEDBACK_KEY))[DOWNLOAD_FEEDBACK_KEY];
    if (!value) return { project: null, value: null };
    const project = await getProject();
    if (!project || value?.projectId !== project.id) value = null;
    if (value?.state === 'running' && await batchActive(project.id) === false) {
      value = { ...value, state: 'interrupted', phase: null };
      await ext.storage.local.set({ [DOWNLOAD_FEEDBACK_KEY]: value });
    }
    return { project, value };
  }
  async function sync() { return serialize(async () => { const { value } = await read(); await paint(value); return value; }); }
  async function handle(message) {
    return serialize(async () => {
      // A start owns a live batch lock; do not interpret its previous receipt as
      // an interruption before replacing it with the new run.
      const project = await getProject();
      if (!project || project.id !== message.projectId) throw new Error('The project changed.');
      let value = (await ext.storage.local.get(DOWNLOAD_FEEDBACK_KEY))[DOWNLOAD_FEEDBACK_KEY];
      if (message.type === 'download-feedback-start') {
        if (typeof message.runId !== 'string' || !message.runId || !Number.isSafeInteger(message.total) || message.total < 1) throw new Error('Invalid download run.');
        value = { projectId: project.id, runId: message.runId, total: message.total, ...counters({}, message.total), state: 'running', phase: 'downloading', acknowledged: false, ...(Number.isInteger(message.ownerTabId) ? { ownerTabId: message.ownerTabId } : {}) };
      } else {
        if (!value || value.projectId !== project.id || value.runId !== message.runId) return { feedback: null };
        if (message.type === 'download-feedback-dismiss') {
          if (!terminal.has(value.state)) throw new Error('Downloads are still running.');
          value = { ...value, acknowledged: true };
        } else {
          if (value.state !== 'running') return { feedback: value };
          const counts = counters(message, value.total);
          if (counts.processed < value.processed) return { feedback: value };
          const state = message.type === 'download-feedback-finish' ? message.state : 'running';
          if (message.type === 'download-feedback-finish' && !terminal.has(state)) throw new Error('Invalid download outcome.');
          if (state === 'finished' && counts.processed !== value.total) throw new Error('The download queue is not finished.');
          if (state === 'running' && !['downloading', 'extracting', 'stopping'].includes(message.phase)) throw new Error('Invalid download phase.');
          value = { ...value, ...counts, state, phase: state === 'running' ? message.phase : null };
        }
      }
      await ext.storage.local.set({ [DOWNLOAD_FEEDBACK_KEY]: value }); await paint(value);
      return { feedback: value };
    });
  }
  ext.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (changes.project || (changes[DOWNLOAD_FEEDBACK_KEY] && changes[DOWNLOAD_FEEDBACK_KEY].newValue === undefined))) sync().catch(() => {});
  });
  ext.tabs?.onRemoved?.addListener(id => {
    if (id === ownerTabId) setTimeout(() => sync().catch(() => {}), 250);
  });
  ext.runtime.onStartup?.addListener(() => sync().catch(() => {}));
  sync().catch(() => {});
  return { handle, sync };
}
