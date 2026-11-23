import { createHash } from 'node:crypto';

// Reviewed upstream legacy builds from pdfjs-dist 6.5.438. A dependency change
// must be reviewed explicitly; never apply these edits to an unknown bundle.
export const PDFJS_UPSTREAM_SHA256 = Object.freeze({
  'pdf.mjs': '2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867',
  'pdf.worker.mjs': '8336aabf764cb08c818555a2fd2545e4fed10837146de927564875c93b3c4f83'
});
export const sha256 = source => createHash('sha256').update(source).digest('hex');

function replaceModule(source, name, variable, expression, explanation) {
  const marker = `// MODULE: ./node_modules/core-js/internals/${name}.js\n`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error(`Expected one core-js ${name} module`);
  const nextModule = /^\/\/ (?:EXTERNAL )?MODULE: /gm;
  nextModule.lastIndex = start + marker.length;
  const end = nextModule.exec(source)?.index;
  if (!end) throw new Error(`Cannot locate end of core-js ${name} module`);
  return source.slice(0, start) + marker +
    `// Modified by BootCaT: ${explanation}\n` +
    `var ${variable} = /*#__PURE__*/__webpack_require__.cw((module) => {\n` +
    `  module.exports = ${expression};\n` +
    `});\n\n` + source.slice(end);
}

export function preparePDFJS(source, filename) {
  if (!PDFJS_UPSTREAM_SHA256[filename] || sha256(source) !== PDFJS_UPSTREAM_SHA256[filename]) {
    throw new Error(`Unreviewed PDF.js bundle: ${filename}. Review scripts/pdfjs-store-build.mjs before updating PDF.js.`);
  }
  let result = replaceModule(source, 'object-create', 'object_create_namespaceFn', 'Object.create',
    'supported browsers provide Object.create; obsolete IE/ActiveX script-iframe fallback removed.');
  result = replaceModule(result, 'global-this', 'global_this_namespaceFn', 'globalThis',
    'supported browsers provide globalThis; obsolete dynamic Function fallback removed.');
  assertPDFJSStoreBuild(result, filename);
  return result;
}

export function assertPDFJSStoreBuild(source, filename) {
  const forbidden = [
    /\bscriptTag\b/, /\bNullProtoObjectVia(?:IFrame|ActiveX)\b/, /\bActiveXObject\b/,
    /\b(?:LT|['"]java['"])\s*\+\s*SCRIPT\b/,
    /\b(?:new\s+)?Function\s*\(\s*['"`]/, /\beval\s*\(/
  ];
  if (forbidden.some(pattern => pattern.test(source))) throw new Error(`Unsupported legacy code in packaged PDF.js: ${filename}`);
}

export const PDFJS_STORE_SHA256 = Object.freeze({
  'pdf.mjs': 'cfbfeb81a9f17e2b9427f72f5d79e79a73b5c7905554378a10865feaa729023f',
  'pdf.worker.mjs': '0a8cf54e2e9e3044beb3029965dfe666dff5056093d0ce41596f5bfc5b740905'
});

// Inspect the serialized ZIP bytes, not just the intermediate build directory.
export async function verifyPackagedPDFJS(bytes) {
  const { zipDirectory, readEntry } = await import('../src/docx.js');
  const entries = zipDirectory(bytes), verified = [];
  const modules = [...entries.keys()].filter(path => path.startsWith('vendor/pdfjs/') && path.endsWith('.mjs')).sort();
  if (JSON.stringify(modules) !== JSON.stringify(['vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs'])) throw new Error('Unexpected PDF.js modules in release ZIP');
  for (const filename of Object.keys(PDFJS_STORE_SHA256)) {
    const source = await readEntry(bytes, entries.get(`vendor/pdfjs/${filename}`));
    assertPDFJSStoreBuild(source, filename);
    const digest = sha256(source);
    if (digest !== PDFJS_STORE_SHA256[filename]) throw new Error(`Unreviewed prepared PDF.js in release ZIP: ${filename}`);
    verified.push({ filename, sha256: digest });
  }
  for (const path of ['vendor/pdfjs/README-BootCaT.md', 'vendor/pdfjs/LICENSE']) {
    if (!entries.has(path)) throw new Error(`Missing PDF.js provenance in release ZIP: ${path}`);
  }
  return verified;
}
