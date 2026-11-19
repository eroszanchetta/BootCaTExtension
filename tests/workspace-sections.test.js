import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initWorkspaceSections, openWorkspaceSection, setProjectSectionState } from '../src/workspace-sections.js';

test('workspace sections collapse on initialization; navigation and download actions reveal only their target', () => {
  const ids = ['project-section', 'seeds-section', 'search-section', 'urls-section', 'review-section'];
  const panels = new Map(ids.map(id => [id, { open: true }]));
  const links = ids.map(id => ({ getAttribute: () => '#' + id, addEventListener(type, handler) { this.click = handler; } }));
  const options = { open: true };
  const scrolled = [];
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => panels.has(id) ? { querySelector: () => panels.get(id), scrollIntoView(options) { assert.equal(panels.get(id).open, true, 'expand before scrolling'); scrolled.push([id, options.block]); } } : null, querySelectorAll: selector => selector === 'details[data-default-collapsed]' ? [options] : links };
  try {
    initWorkspaceSections(); assert.ok([...panels.entries()].every(([id, panel]) => panel.open === (id === 'project-section'))); assert.equal(options.open, false);
    links[2].click(); assert.equal(panels.get('search-section').open, true);
    assert.equal(panels.get('urls-section').open, false);
    assert.deepEqual(scrolled, []);
    openWorkspaceSection('review-section', { scroll: true });
    assert.deepEqual(scrolled, [['review-section', 'start']]);
    setProjectSectionState(true); assert.equal(panels.get('project-section').open, true);
    setProjectSectionState(false); assert.equal(panels.get('project-section').open, true);
    openWorkspaceSection('top', { scroll: true });
    options.open = true;
    initWorkspaceSections(); assert.ok([...panels.entries()].every(([id, panel]) => panel.open === (id === 'project-section'))); assert.equal(options.open, false);
  } finally { globalThis.document = previous; }
});
