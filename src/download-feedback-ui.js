import { DOWNLOAD_FEEDBACK_KEY, downloadSummary, feedbackAppearance } from './download-feedback.js';
import { getExtensionAPI } from './extension-api.js';
export function initDownloadFeedbackUI({ getProjectId, getCorpusState = () => null, onExport }) {
  const ext = getExtensionAPI(), el = id => document.getElementById(id);
  const strip = el('download-feedback-strip'), summary = el('download-feedback-summary'), progress = el('header-download-progress');
  const details = el('download-run-details');
  const link = el('download-feedback-link');
  const receipt = el('download-completion-summary'), dismiss = el('dismiss-download-feedback');
  let current = null, destroyed = false, changed = false;
  function render(value) {
    if (destroyed) return;
    current = value?.projectId === getProjectId() ? value : null;
    const look = feedbackAppearance(current);
    document.title = look.tabTitle;
    strip.hidden = !current || !!current.acknowledged;
    strip.setAttribute('data-state', look.tone);
    summary.textContent = current ? downloadSummary(current) : '';
    const corpus = look.tone === 'finished' ? getCorpusState() : null;
    if (corpus) summary.textContent = !corpus.included ? 'No documents included.' : corpus.exportSaved ? 'Your corpus download has started.' : 'Your corpus is ready to export.';
    link.textContent = corpus ? 'Go to export' : 'View downloads';
    link.href = corpus ? '#project-section' : '#review-section';
    link.hidden = !!corpus && (!corpus.included || corpus.exportSaved);
    progress.hidden = !current || current.state !== 'running';
    progress.max = Math.max(1, current?.total || 0); progress.value = current?.processed || 0;
    if (current) { el('progress').max = progress.max; el('progress').value = progress.value; }
    dismiss.hidden = !current || current.state === 'running';
    receipt.hidden = !current || current.state === 'running';
    details.hidden = receipt.hidden;
    receipt.textContent = receipt.hidden ? '' : 'Original download: ' + downloadSummary({ ...current, remainingIssues: undefined });
  }
  link.addEventListener('click', event => {
    if (link.getAttribute('href') === '#project-section' && onExport) { event.preventDefault(); onExport(); }
  });
  dismiss.addEventListener('click', async () => {
    if (!current || current.state === 'running') return;
    const runId = current.runId;
    dismiss.disabled = true;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'download-feedback-dismiss', projectId: getProjectId(), runId });
      if (!reply?.ok) throw new Error(reply?.error || 'Could not dismiss feedback.');
      if (current?.runId === runId) {
        render(reply.feedback);
        document.querySelector('nav a[href="#review-section"]')?.focus({ preventScroll: true });
      }
    } catch (error) { summary.textContent = error.message; }
    finally { dismiss.disabled = false; }
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[DOWNLOAD_FEEDBACK_KEY]) { changed = true; render(changes[DOWNLOAD_FEEDBACK_KEY].newValue); }
  });
  ext.runtime.sendMessage({ type: 'get-download-feedback' }).then(reply => { if (!changed && reply?.ok) render(reply.feedback); }).catch(() => {});
  return { refresh() { render(current); }, destroy() { render(null); destroyed = true; } };
}
