import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './build.mjs';

// Export the in-extension policy itself so the public copy cannot silently drift.
export async function exportPrivacy(outputRoot = join(ROOT, 'dist', 'packages')) {
  const source = await readFile(join(ROOT, 'src/about.html'), 'utf8');
  const policy = source.match(/<section aria-labelledby="privacy-heading">[\s\S]*?<\/section>/)?.[0];
  const header = source.match(/<header>[\s\S]*?<\/header>/)?.[0];
  if (!policy || !header) throw new Error('Cannot locate About page privacy policy/header; review the public privacy export.');
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BootCaT · Privacy policy</title>
  <style>
    :root { color-scheme: light; font: 16px/1.6 system-ui, sans-serif; color: #24323b; background: #f4f8fb; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 850px; margin: 40px auto; padding: 0 24px; }
    section { background: white; border: 1px solid #c4d8e7; border-radius: 12px; padding: 24px; }
    h1, h2, h3 { line-height: 1.3; }
    a, .badge { color: #006f99; }
  </style>
</head>
<body><main>
${header.replace('<h1>About and privacy</h1>', '<h1>Privacy policy</h1>')}
${policy}
</main></body>
</html>
`;
  await mkdir(outputRoot, { recursive: true });
  const path = join(outputRoot, 'bootcat-privacy.html');
  await writeFile(path, page);
  return path;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await exportPrivacy());
