import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindImportFileDrop, guardFileDropNavigation } from '../src/import-file-drop.js';
function fixture() {
  const handlers = {}, classes = new Set(), imported = [], errors = [];
  let ready = true;
  const button = { disabled: false, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } }, addEventListener(type, fn) { handlers[type] = fn; } };
  bindImportFileDrop({ button, canImport: () => ready, onFile: async file => imported.push(file), onError: message => errors.push(message) });
  const event = dataTransfer => ({ dataTransfer, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  return { handlers, classes, imported, errors, button, event, ready: value => { ready = value; } };
}
test('a genuine File uses one target even when drag metadata also includes a URL', async () => {
  const f = fixture(), file = new Blob(['document']);
  const transfer = { types: ['Files', 'text/uri-list'], files: [file], items: [{ kind: 'file' }] };
  const over = f.event(transfer); f.handlers.dragover(over);
  assert.equal(over.prevented, true); assert.equal(over.stopped, true); assert.equal(transfer.dropEffect, 'copy');
  assert.equal(f.classes.has('file-drop-active'), true);
  const drop = f.event(transfer); await f.handlers.drop(drop);
  assert.deepEqual(f.imported, [file]); assert.equal(drop.prevented, true); assert.equal(drop.stopped, true);
  assert.equal(f.classes.has('file-drop-active'), false);
});
test('links, multiple files, folders and busy targets never reach the importer', async () => {
  const f = fixture(), file = new Blob(['one']);
  for (const transfer of [
    { files: [], types: ['text/uri-list'] },
    { files: [file, file], types: ['Files'] },
    { files: [file], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] }
  ]) await f.handlers.drop(f.event(transfer));
  assert.match(f.errors[0], /not a link/); assert.match(f.errors[1], /one file/); assert.match(f.errors[2], /not a folder/);
  f.ready(false); await f.handlers.drop(f.event({ files: [file] }));
  assert.match(f.errors.at(-1), /finish processing/);
  f.ready(true); f.button.disabled = true; await f.handlers.drop(f.event({ files: [file] }));
  assert.equal(f.imported.length, 0);
});
test('file drops outside controls are cancelled without interfering with text or link drops', () => {
  const handlers = {}, removed = []; let messages = 0;
  const root = { addEventListener(type, fn) { handlers[type] = fn; }, removeEventListener(type) { removed.push(type); } };
  const dispose = guardFileDropNavigation({ root, onOutsideDrop: () => messages++ });
  const f = fixture(), file = f.event({ types: ['Files'], files: [new Blob(['file'])] });
  handlers.dragover(file); assert.equal(file.dataTransfer.dropEffect, 'none'); handlers.drop(file);
  assert.equal(file.prevented, true); assert.equal(messages, 1);
  const link = f.event({ types: ['text/uri-list'] }); handlers.dragover(link); handlers.drop(link);
  assert.equal(link.prevented, false); assert.equal(messages, 1);
  dispose(); assert.deepEqual(removed, ['dragover', 'drop']);
});
