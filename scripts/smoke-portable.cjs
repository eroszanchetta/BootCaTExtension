// Exchange the exact same portable file between native browser engines.
const { chromium, firefox } = require('playwright');
const { execFileSync } = require('node:child_process');
const { createServer } = require('node:http');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, extname, join } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = resolve(__dirname, '../src');
  const server = createServer(async (request, response) => {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) { response.writeHead(404); response.end(); return; }
    try { const body = await readFile(path); response.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'text/html'); response.end(body); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browsers = [], pages = [];
  const downloads = await mkdtemp(join(tmpdir(), 'bootcat-project-downloads-'));
  try {
    for (const engine of [chromium, firefox]) {
      const browser = await engine.launch({ headless: true }); browsers.push(browser);
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/about.html`); pages.push(page);
    }
    for (const [producer, receiver, forceZIP64] of [[0, 1, false], [1, 0, true]]) {
      const bytes = await pages[producer].evaluate(async forceZIP64 => {
        const s = await import('./project-store.js'), { savePage } = await import('./page-store.js');
        const { makeProjectArchive } = await import('./portable-project.js');
        const project = { id: 'source', name: 'Energia 中文 à', language: 'none', nameConfirmed: true };
        await s.resetStoredProject(project.id, {}, project);
        await s.saveDraft(project.id, { seeds: 'ènergie\n中文', tuples: 'ènergie 中文', preparedQueries: ['ènergie 中文'], urls: 'https://example.test/html' });
        for (const [kind, content] of [['html', [60,112,62,195,168,60,47,112,62]], ['pdf', [37,80,68,70,45,0,255]], ['docx', [80,75,3,4,0,255]]]) {
          const url = `https://example.test/${kind}`, filename = `pages/00000${kind}.${kind}`;
          await s.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: `corpus/${kind}.txt`, extraction: { status: 'ok', warnings: [], characters: 8, included: kind !== 'html', text: 'original', ...(kind === 'pdf' ? { rawText: 'raw PDF layout' } : {}) } }, new Blob([new Uint8Array(content)]));
          if (kind === 'html') await s.saveEditedText(project.id, url, { filename, revision: 0 }, 'edited è 中文', { status: 'ok', warnings: [], characters: 11, included: false });
        }
        await s.saveFailure(project.id, { url: 'https://failed.test/', outcome: 'error', error: '403' });
        await savePage({ id: 'queued', url: 'https://queued.test/', html: '<p>Pending è 中文</p>' }, project.id);
        const snapshot = await s.snapshotStoredProject(project), archive = await makeProjectArchive(snapshot, { forceZIP64 });
        return Array.from(new Uint8Array(await archive.arrayBuffer()));
      }, forceZIP64);
      const result = await pages[receiver].evaluate(async bytes => {
        const s = await import('./project-store.js'), { openProjectArchive, restoredProjectSnapshot } = await import('./portable-project.js');
        const expected = (await s.storedProjectId()) ?? null;
        const snapshot = restoredProjectSnapshot(await openProjectArchive(new Blob([new Uint8Array(bytes)])));
        await s.replaceStoredProject(expected, snapshot, snapshot.project);
        const id = snapshot.project.id, state = await s.loadWorkspace(id);
        return { name: snapshot.project.name, seeds: state.draft.seeds, entries: state.entries.length, excluded: state.entries.find(e => e.url.endsWith('/html')).doc.extraction.included,
          text: await (await s.readText(id, 'https://example.test/html')).text(), baseline: await (await s.readOriginalText(id, 'https://example.test/html')).text(), raw: await (await s.readRawText(id, 'https://example.test/pdf')).text(),
          pdf: Array.from(new Uint8Array(await (await s.readOriginal(id, 'pages/00000pdf.pdf')).arrayBuffer())), pending: (await s.snapshotStoredProject(snapshot.project)).stores.pages[0].html };
      }, bytes);
      assert.deepEqual(result, { name: 'Energia 中文 à', seeds: 'ènergie\n中文', entries: 4, excluded: false, text: 'edited è 中文', baseline: 'original', raw: 'raw PDF layout', pdf: [37,80,68,70,45,0,255], pending: '<p>Pending è 中文</p>' });
      console.log(`${producer === 0 ? 'Chromium → Firefox' : 'Firefox → Chromium'} portable project round trip passed${forceZIP64 ? ' (ZIP64)' : ''}.`);
    }
    // A successful in-page arrayBuffer() read is not a successful browser
    // download. Exercise the real Save Project UI and staged background handoff
    // with persisted, file-backed originals in BOTH engines, after an import.
    for (const [index, page] of pages.entries()) {
      const name = index === 0 ? 'Chromium' : 'Firefox';
      const helper = await page.context().newPage(); await helper.goto(`http://127.0.0.1:${server.address().port}/about.html`);
      const project = await helper.evaluate(async () => {
        const s = await import('./project-store.js');
        const project = (await s.storedProjectState()).project;
        const url = 'https://example.test/large', filename = 'pages/large.bin';
        await s.saveDocument(project.id, { url, filename, outcome: 'downloaded' }, { url, filename, textFilename: 'corpus/large.txt', extraction: { status: 'ok', warnings: [], characters: 7, included: true, text: 'content' } }, new Blob([new Uint8Array(12 * 1024 * 1024 + 7).fill(90)]));
        return project;
      });
      await page.exposeFunction('prepareSavedProject', () => helper.evaluate(async () => {
        const s = await import('./project-store.js'), { stageProject } = await import('./project-transfer.js');
        const project = (await s.storedProjectState()).project;
        return { ok: true, token: await stageProject(await s.snapshotStoredProject(project)) };
      }));
      await page.setContent('<button id="save-project">Save Project</button><input id="project-file-picker" type="file" hidden><div id="project-save-feedback"><p id="project-file-status"></p><button id="project-download-again" hidden>Download again</button></div>');
      await page.evaluate(async project => {
        globalThis.chrome = { runtime: { sendMessage: message => {
          if (message.type !== 'prepare-project-save') throw new Error('Unexpected request');
          return globalThis.prepareSavedProject();
        } } };
        const { initPortableUI } = await import('./portable-ui.js');
        const saveButton = document.getElementById('save-project');
        const ui = initPortableUI({ getProject: () => project, isBusy: () => false, isDirty: () => false, flush: async () => {}, exclusive: task => task(), onBusy: busy => { saveButton.disabled = busy; }, version: 'test' });
        saveButton.addEventListener('click', () => ui.save().catch(error => { document.getElementById('project-file-status').textContent = error.message; }));
      }, project);
      const pending = page.waitForEvent('download'); await page.click('#save-project'); const download = await pending;
      assert.equal(await download.failure(), null, `${name}: download must complete, not leave a .part file`);
      assert.ok(download.suggestedFilename().endsWith('.bootcat'));
      const path = join(downloads, `${name}.bootcat`); await download.saveAs(path);
      execFileSync('python3', ['-c', "import sys,zipfile,json,datetime; z=zipfile.ZipFile(sys.argv[1]); t=datetime.datetime.fromisoformat(json.loads(z.read('project.json'))['savedAt'].replace('Z','+00:00')).astimezone(); expected=(t.year,t.month,t.day,t.hour,t.minute,t.second//2*2); assert all(i.date_time==expected for i in z.infolist())", path]);
      await page.waitForFunction(() => document.querySelector('#project-save-feedback').classList.contains('saved'));
      assert.equal(await page.locator('#save-project').isDisabled(), true);
      const { openProjectArchive } = await import('../src/portable-project.js');
      const archive = await openProjectArchive(new Blob([await readFile(path)]));
      const original = archive.stores.files.find(record => record.name === 'pages/large.bin').blob;
      assert.equal(original.size, 12 * 1024 * 1024 + 7); assert.equal(await original.slice(-7).text(), 'ZZZZZZZ');
      assert.equal(await page.evaluate(async () => {
        return new Promise((resolve, reject) => { const r = indexedDB.open('bootcat-project-transfer'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction('transfers'); const count = tx.objectStore('transfers').count(); count.onsuccess = () => resolve(count.result); tx.oncomplete = () => db.close(); }; });
      }), 0, 'temporary snapshot cleanup completes without invalidating downloaded originals');
      await helper.close(); console.log(`${name} ${await browsers[index].version()}: Save Project download of imported project with 12 MiB stored original completed and ZIP checksums verified.`);
    }
  } finally { for (const browser of browsers) await browser.close(); server.close(); await rm(downloads, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
