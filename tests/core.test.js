import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseURLs, filenameFor, fetchFile, urlListWarning } from "../src/core.js";
import { makeZIP } from "../src/zip.js";

test("URL validation, deduplication, fragments and credentials", () => {
  assert.deepEqual(parseURLs("https://example.com#one\n\nhttps://example.com/#two\nhttp://example.org/a?q=1"), {
    urls: ["https://example.com/", "http://example.org/a?q=1"], errors: []
  });
  assert.equal(parseURLs("javascript:alert(1)\nfile:///etc/passwd\nhttps://user:secret@example.com\nbroken").errors.length, 4);
  assert.equal(parseURLs(Array.from({ length: 501 }, (_, i) => `https://example.com/${i}`).join("\n")).errors.length, 0);
  assert.equal(urlListWarning(500), '');
  assert.match(urlListWarning(501), /may take longer/);
  assert.equal(filenameFor("https://example.com/../../evil", "text/html; charset=UTF-8", 0), "pages/0001-example.com.html");
});

test("downloads preserve bytes, follow redirects, reject HTTP failures, bound streams and cancel", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/binary" }); res.end(); }
    else if (req.url === "/fail") { res.writeHead(404); res.end("missing"); }
    else if (req.url === "/slow") { res.writeHead(200); res.flushHeaders(); }
    else { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(Buffer.from([0, 255, 10, 128])); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await fetchFile(`${base}/redirect`, new AbortController().signal);
    assert.deepEqual([...result.bytes], [0, 255, 10, 128]);
    assert.equal(result.finalURL, `${base}/binary`);
    await assert.rejects(fetchFile(`${base}/fail`), /HTTP 404/);
    await assert.rejects(fetchFile(`${base}/binary`, undefined, 2), /limit exceeded/);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    await assert.rejects(fetchFile(`${base}/slow`, controller.signal), { name: "AbortError" });
    clearTimeout(timer);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("ZIP passes independent Python CRC and binary/Unicode roundtrip checks", async () => {
  const path = join(tmpdir(), `bootcat-zip-test-${process.pid}.zip`);
  await writeFile(path, new Uint8Array(await makeZIP([
    { name: "pages/0001-example.bin", data: new Uint8Array([0, 255, 128]) },
    { name: "caffè.txt", data: "こんにちは — caffè" },
    { name: "empty.txt", data: "" }
  ]).arrayBuffer()));
  execFileSync("python3", ["-c", "import sys,zipfile,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p); assert z.testzip() is None; assert z.read('pages/0001-example.bin') == bytes([0,255,128]); assert z.read('caffè.txt').decode() == 'こんにちは — caffè'; assert z.read('empty.txt') == b''; z.close(); p.unlink()", path]);
});
