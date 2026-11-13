import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmAction } from '../src/dialogs.js';

test('confirmations default to cancel, handle repeated opening and reject overlapping requests', async () => {
  const previous = globalThis.document, nodes = new Map(); let closed;
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', classList: { toggle() {} }, focus() { this.focused = true; } });
    return nodes.get(id);
  };
  const dialog = get('confirmation-dialog');
  Object.assign(dialog, {
    open: false, returnValue: '',
    addEventListener(type, handler) { assert.equal(type, 'close'); closed = handler; },
    removeEventListener() { closed = null; },
    showModal() { this.open = true; },
    close(value) { if (value !== undefined) this.returnValue = value; this.open = false; closed(); }
  });
  globalThis.document = { getElementById: get };
  try {
    const first = confirmAction({ title: 'Delete document?', message: 'Remove saved text?', confirmLabel: 'Delete document', destructive: true });
    assert.equal(dialog.open, true); assert.equal(get('confirmation-cancel').focused, true);
    assert.equal(get('confirmation-title').textContent, 'Delete document?');
    assert.equal(await confirmAction({ title: 'Another action' }), false);
    assert.equal(get('confirmation-title').textContent, 'Delete document?');
    dialog.close('confirm'); assert.equal(await first, true);
    const second = confirmAction({ title: 'Run all queries?', message: 'Open tabs?' });
    assert.equal(dialog.returnValue, 'cancel', 'Escape must not reuse a previous acceptance');
    dialog.close(); assert.equal(await second, false);
    const third = confirmAction({ title: 'Clear searches?', message: 'Clear saved searches?' });
    dialog.close('cancel'); assert.equal(await third, false);
  } finally { globalThis.document = previous; }
});
