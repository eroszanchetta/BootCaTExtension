// Passed to scripting.executeScript: keep this function self-contained.
export function captureCurrentPage({ captureMiB = 2, htmlElements = 60000 } = {}) {
  if (/^https?:$/.test(location.protocol) && document.contentType === 'application/pdf') {
    return { pdf: true, url: location.href };
  }
  if (!/^https?:$/.test(location.protocol) || !['text/html', 'application/xhtml+xml'].includes(document.contentType)) {
    return { error: 'Open an HTTP or HTTPS HTML page first. Browser pages cannot be captured.' };
  }
  if (document.querySelectorAll('*').length > htmlElements) return { error: 'This page is too complex to save.' };
  const url = new URL(location.href);
  if (url.username || url.password) return { error: 'URLs containing credentials cannot be saved.' };
  const clone = document.documentElement.cloneNode(true);
  // Save a passive snapshot. Do not copy editable fields or embedded documents.
  for (const node of clone.querySelectorAll('script:not([type="application/ld+json"]), iframe, frame, object, embed, input, textarea, select, button, base, meta[charset], meta[http-equiv]')) node.remove();
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === 'srcdoc') node.removeAttribute(attr.name);
    }
  }
  const charset = document.createElement('meta'); charset.setAttribute('charset', 'utf-8');
  clone.querySelector('head')?.prepend(charset);
  const html = '<!doctype html>\n' + clone.outerHTML;
  if (new TextEncoder().encode(html).length > captureMiB * 1024 * 1024) return { error: `This page exceeds the ${captureMiB} MiB snapshot limit.` };
  return { url: url.href, title: document.title, html, capturedAt: new Date().toISOString() };
}
