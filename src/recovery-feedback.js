import { hasLanguageWarning, languageMessage } from './language-detection.js';
import { openWorkspaceSection } from './workspace-sections.js';

export function preserveRecoveryInclusion(extraction, previous) {
  // A failed extraction's default exclusion is not a deliberate user choice.
  if (previous?.status !== 'ok' || hasLanguageWarning(previous)) return extraction;
  return { ...extraction, included: previous.included };
}
export function recoveryOutcome(entry, format) {
  const extraction = entry.doc?.extraction;
  if (extraction?.status !== 'ok') {
    const reason = extraction?.warnings?.join(' ') || 'No usable text was extracted.';
    return { tone: 'warning', message: `${format} imported. Original file saved, but text recovery failed. ${reason} The document remains in Documents with issues.` };
  }
  if (hasLanguageWarning(extraction)) return { tone: 'warning', message: `${format} imported. Text recovered, but it still needs review. ${languageMessage(extraction)} The document remains in Documents with issues.` };
  return { tone: 'success', message: `${format} imported. Text recovered successfully. Added to Corpus documents${extraction.included ? ' and included in the corpus.' : '; it remains excluded from the corpus.'}` };
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
      const highlight = { tone: item.tone, expires: Date.now() + 2000 };
      highlights.set(item.url, highlight); apply(target, item.url);
      later(() => {
        if (highlights.get(item.url) !== highlight) return;
        highlights.delete(item.url);
        const current = getRow(item.url); current?.classList.remove('recovery-success', 'recovery-attention');
      }, 2000);
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }
  function show(item) { latest = item; pending = item; showButton.hidden = false; flush(); }
  showButton.addEventListener('click', () => { if (latest) { pending = latest; flush(); } });
  document.addEventListener('close', flush, true);
  return { show, apply, flush, forget(url) { highlights.delete(url); if (latest?.url === url) { latest = pending = null; revision++; showButton.hidden = true; } }, begin() { latest = pending = null; revision++; showButton.hidden = true; },
    destroy() { destroyed = true; revision++; for (const id of timers) clearTimeout(id); timers.clear(); highlights.clear(); document.removeEventListener('close', flush, true); } };
}
