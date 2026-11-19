// Exchange the exact same portable file between native browser engines.
const { chromium, firefox } = require('playwright');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
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
  try {
    for (const engine of [chromium, firefox]) {
      const browser = await engine.launch({ headless: true }); browsers.push(browser);
      const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/about.html`); pages.push(page);
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
  } finally { for (const browser of browsers) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
