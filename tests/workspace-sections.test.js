import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWorkspaceSections, openWorkspaceSection } from '../src/workspace-sections.js';

test('workspace sections collapse on initialization; navigation and preview reveal only their target', () => {
  const ids = ['seeds-section', 'search-section', 'urls-section', 'review-section', 'preview-section'];
  const panels = new Map(ids.map(id => [id, { open: true }]));
  const links = ids.map(id => ({ getAttribute: () => '#' + id, addEventListener(type, handler) { this.click = handler; } }));
  const scrolled = [];
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => panels.has(id) ? { querySelector: () => panels.get(id), scrollIntoView(options) { assert.equal(panels.get(id).open, true, 'expand before scrolling'); scrolled.push([id, options.block]); } } : null, querySelectorAll: () => links };
  try {
    initWorkspaceSections(); assert.ok([...panels.values()].every(panel => !panel.open));
    links[1].click(); assert.equal(panels.get('search-section').open, true);
    assert.equal(panels.get('urls-section').open, false);
    assert.deepEqual(scrolled, []);
    openWorkspaceSection('preview-section', { scroll: true }); assert.equal(panels.get('preview-section').open, true);
    openWorkspaceSection('review-section', { scroll: true });
    assert.deepEqual(scrolled, [['preview-section', 'start'], ['review-section', 'start']]);
    openWorkspaceSection('top', { scroll: true });
    initWorkspaceSections(); assert.ok([...panels.values()].every(panel => !panel.open));
  } finally { globalThis.document = previous; }
});
