import { hasLanguageWarning } from './language-detection.js';
import { openWorkspaceSection } from './workspace-sections.js';

export function preserveRecoveryInclusion(extraction, previous) {
  // A failed extraction's default exclusion is not a deliberate user choice.
  if (previous?.status !== 'ok' || hasLanguageWarning(previous)) return extraction;
  return { ...extraction, included: previous.included };
}
export function recoveryOutcome(entry, format) {
  const extraction = entry.doc?.extraction;
  if (extraction?.status !== 'ok') {
    return { tone: 'warning', message: 'File imported · text still unavailable' };
  }
  if (hasLanguageWarning(extraction)) return { tone: 'warning', message: 'File imported · language review needed' };
  return { tone: 'success', message: 'Download recovered' };
}

export function initRecoveryFeedback({ getRow, isBlocked }) {
  const showButton = document.getElementById('show-imported-document');
  const highlights = new Map(), timers = new Set();
  let latest = null, pending = null, destroyed = false, revision = 0;
  function later(fn, delay) {
    const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, delay); timers.add(id);
  }
  function apply(row, url) {
    const value = highlights.get(url), remaining = (value?.expires || 0) - Date.now();
    if (!row || remaining <= 0) return;
    row.classList.remove('recovery-success', 'recovery-attention');
    // Restart a repeated reveal and discard the previous outcome's color.
    void row.offsetWidth;
    row.style.setProperty('--recovery-highlight-duration', `${remaining}ms`);
    row.classList.add(value.tone === 'success' ? 'recovery-success' : 'recovery-attention');
  }
  function flush() {
    if (destroyed || !pending || isBlocked()) return;
    const item = pending, token = ++revision;
    const row = getRow(item.url);
    if (!row) { pending = null; return; }
    openWorkspaceSection('review-section');
    const panel = document.getElementById(row.parentNode.id === 'results' ? 'documents-section' : 'attention-section');
    panel.hidden = false; panel.open = true;
    // Find the current row after disclosures, focus restoration and metadata
    // refreshes have settled; a saved row may already have been replaced.
    const reveal = () => {
      if (destroyed || token !== revision || isBlocked()) return;
      const target = getRow(item.url);
      if (!target || target.isConnected === false) return;
      pending = null;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const top = target.getBoundingClientRect().top;
      if (top < offset) window.scrollBy({ top: top - offset, behavior: 'instant' });
      for (const url of new Set(item.urls || [item.url])) {
        const current = getRow(url); if (!current) continue;
        const highlight = { tone: item.tone, expires: Date.now() + 2000 };
        highlights.set(url, highlight); apply(current, url);
        later(() => {
          if (highlights.get(url) !== highlight) return;
          highlights.delete(url);
          getRow(url)?.classList.remove('recovery-success', 'recovery-attention');
        }, 2000);
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }
  function show(item) { latest = item; pending = item; showButton.hidden = false; showButton.textContent = item.urls?.length > 1 ? 'Show documents' : 'Show document'; flush(); }
  showButton.addEventListener('click', () => { if (latest) { pending = latest; flush(); } });
  document.addEventListener('close', flush, true);
  return { show, apply, flush, forget(url) { highlights.delete(url); if (latest?.url === url) { latest = pending = null; revision++; showButton.hidden = true; } }, begin() { latest = pending = null; revision++; showButton.hidden = true; },
    destroy() { destroyed = true; revision++; for (const id of timers) clearTimeout(id); timers.clear(); for (const url of highlights.keys()) getRow(url)?.classList.remove('recovery-success', 'recovery-attention'); highlights.clear(); document.removeEventListener('close', flush, true); } };
}
