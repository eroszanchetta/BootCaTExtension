import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWorkspaceSections, openWorkspaceSection } from '../src/workspace-sections.js';

test('workspace sections collapse on initialization; navigation and preview reveal only their target', () => {
  const ids = ['seeds-section', 'search-section', 'urls-section', 'review-section', 'preview-section'];
  const panels = new Map(ids.map(id => [id, { open: true }]));
  const links = ids.map(id => ({ getAttribute: () => '#' + id, addEventListener(type, handler) { this.click = handler; } }));
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => panels.has(id) ? { querySelector: () => panels.get(id) } : null, querySelectorAll: () => links };
  try {
    initWorkspaceSections(); assert.ok([...panels.values()].every(panel => !panel.open));
    links[1].click(); assert.equal(panels.get('search-section').open, true);
    assert.equal(panels.get('urls-section').open, false);
    openWorkspaceSection('preview-section'); assert.equal(panels.get('preview-section').open, true);
    openWorkspaceSection('top');
    initWorkspaceSections(); assert.ok([...panels.values()].every(panel => !panel.open));
  } finally { globalThis.document = previous; }
});
