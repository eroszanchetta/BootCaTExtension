// Dynamically registered only when enabled for an active project. This isolated
// content script exposes no page-facing commands and never collects on load.
(() => {
  if (window !== window.top || !['text/html', 'application/xhtml+xml'].includes(document.contentType)) return;
  const ext = globalThis.browser ?? globalThis.chrome;
  if (!ext?.runtime) return;
  const previous = globalThis.__bootcatFloatingControl;
  if (previous) { previous.refresh(); return; }
  let host, root, primary, feedback, tooltip, current, busy = false, flash = false, note = '', refreshRevision = 0, generation = 0, flashTimer;
  let documentURL = location.href, collectionResult = null, collectionFailed = false;
  const readResults = null; // Shared collector embedded by the build.
  const ddgAdapter = null;
  let observedKey, observedURL = location.href, refreshTimer;
  function pageKey() {
    if (!/^(www\.|html\.)?duckduckgo\.com$/.test(location.hostname)) return '';
    return readResults(ddgAdapter)?.resultSetKey || '';
  }
  function watchPage() {
    if (!current?.enabled || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!current?.enabled) return;
      const key = pageKey();
      if (location.href !== observedURL || key !== observedKey) {
        observedURL = location.href; observedKey = key;
        generation++; busy = flash = false; note = ''; collectionResult = null; collectionFailed = false; clearTimeout(flashTimer);
        refresh();
      } else if (host && !host.isConnected) render();
    }, 200);
  }
  const mascot = null; // Populated from the shared SVG by the build.
  const summarize = null; // Populated from shared collection feedback by the build.
  const paths = {
    collect: ['M5 4h14v4H5zM5 11h14M5 16h9M5 21h14', 'm16 15 3 3 3-3m-3-4v7'],
    capture: ['M13 3H5v18h8M13 3l6 6v3M13 3v6h6M8 13h3M8 17h3', 'M18 15v6m-3-3h6'],
    workspace: ['M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z'],
    hide: ['m6 6 12 12M18 6 6 18'],
    saved: ['m5 12 4 4L20 5'],
    busy: ['M12 3a9 9 0 1 1-9 9']
  };
  function icon(button, kind) {
    button.replaceChildren();
    if (kind === 'workspace' && mascot) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', mascot.viewBox); svg.setAttribute('width', '22'); svg.setAttribute('height', '26'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('fill-rule', 'evenodd');
      for (const attrs of mascot.paths) { const path = document.createElementNS(svg.namespaceURI, 'path'); for (const [key, value] of Object.entries(attrs)) path.setAttribute(key, value); svg.append(path); }
      button.append(svg); return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    for (const data of paths[kind]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', data); svg.append(path); }
    if (kind === 'busy') svg.classList.add('spin'); button.append(svg);
  }
  function label(button, value) { button.setAttribute('aria-label', value); button.dataset.tooltip = value; }
  function button(kind, name, action) {
    const item = document.createElement('button'); item.type = 'button'; label(item, name); icon(item, kind);
    item.addEventListener('click', event => { if (!event.isTrusted || item.disabled) return; event.stopPropagation(); action(); });
    for (const type of ['mouseenter', 'focus']) item.addEventListener(type, () => { tooltip.textContent = item.dataset.tooltip; tooltip.hidden = false; item.setAttribute('aria-describedby', 'bootcat-floating-tooltip'); });
    for (const type of ['mouseleave', 'blur']) item.addEventListener(type, () => { tooltip.hidden = true; item.removeAttribute('aria-describedby'); });
    return item;
  }
  function remove() { host?.remove(); host = root = primary = feedback = tooltip = undefined; }
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div'); host.id = 'bootcat-floating-' + Math.random().toString(36).slice(2); host.setAttribute('data-bootcat-floating-control', '');
    for (const [key, value] of Object.entries({ all: 'initial', position: 'fixed', 'z-index': '2147483647', display: 'block', width: 'max-content', 'max-width': 'calc(100vw - 32px)', margin: '0', padding: '0', border: '0', 'pointer-events': 'auto' })) host.style.setProperty(key, value, 'important');
    root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`:host{color-scheme:light}*{box-sizing:border-box}.strip{position:relative;display:flex;gap:3px;padding:4px;background:#fff;border:1px solid #8daebf;border-radius:10px;box-shadow:0 2px 12px #17394c35;color:#006e98;font:13px/1.4 system-ui,sans-serif}button{display:grid;place-items:center;width:32px;height:32px;padding:5px;border:0;border-radius:6px;background:#eef6fa;color:inherit;cursor:pointer}button:hover{background:#d4eaf4}button:focus-visible{outline:3px solid #005e83;outline-offset:1px}button:disabled{cursor:default;opacity:.55}.bubble{position:absolute;right:0;top:calc(100% + 7px);width:max-content;max-width:min(280px,calc(100vw - 32px));padding:8px 10px;border:1px solid #8daebf;border-radius:8px;box-shadow:0 2px 10px #17394c25;background:#fff;color:#24323b;white-space:normal;overflow-wrap:anywhere}.bottom .bubble{top:auto;bottom:calc(100% + 7px)}.left .bubble{right:auto;left:0}.choices{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.choices button{display:block;width:auto;height:auto;padding:6px 8px;font:inherit;text-align:left}.error{border-color:#a22d25;color:#87352e}.spin{animation:turn 1s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}[hidden]{display:none!important}`);
    // Firefox ESR 140 requires an array in the page realm for this DOM setter.
    // Clone only the array of native stylesheet reflectors; never export functions.
    root.adoptedStyleSheets = typeof cloneInto === 'function' ? cloneInto([sheet], document.defaultView, { wrapReflectors: true }) : [sheet];
    const strip = document.createElement('div'); strip.className = 'strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'BootCaT collection controls');
    tooltip = document.createElement('div'); tooltip.id = 'bootcat-floating-tooltip'; tooltip.className = 'bubble'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
    feedback = document.createElement('div'); feedback.className = 'bubble'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true;
    primary = button('capture', 'Add this page to corpus', perform);
    strip.append(button('workspace', 'Open BootCaT', () => command('floating-open-workspace')), primary, button('hide', 'Hide floating controls', () => command('floating-hide')), tooltip, feedback);
    root.append(strip); document.documentElement.append(host);
  }
  function render() {
    if (!current?.enabled || (current.saved && !busy && !flash && !note)) { remove(); return; }
    mount();
    const position = current.position || 'top-right', top = position.startsWith('top'), left = position.endsWith('left');
    for (const [key, value] of Object.entries({ top: top ? '16px' : 'auto', bottom: top ? 'auto' : '16px', left: left ? '16px' : 'auto', right: left ? 'auto' : '16px' })) host.style.setProperty(key, value, 'important');
    const strip = root.querySelector('.strip'); strip.classList.toggle('bottom', !top); strip.classList.toggle('left', left);
    primary.disabled = busy || flash || current.saved;
    icon(primary, busy ? 'busy' : flash || current.saved ? 'saved' : current.action === 'collect' ? 'collect' : 'capture');
    label(primary, busy ? 'Saving…' : flash || current.saved ? 'Saved in BootCaT' : current.action === 'collect' ? `Add URLs from this tab to corpus${current.closeAfterSuccess ? ' and close tab' : ''}` : `Add this page to corpus${current.closeAfterSuccess ? ' and close tab' : ''}`);
    feedback.replaceChildren();
    const text = document.createElement('div'); text.textContent = note; feedback.append(text);
    if (note && current.action === 'collect') {
      const choices = document.createElement('div'); choices.className = 'choices';
      const review = document.createElement('button'); review.type = 'button';
      review.textContent = collectionResult?.unresolved ? 'Continue with collected URLs' : collectionFailed ? 'Return to BootCaT' : 'Review URLs';
      review.addEventListener('click', async event => {
        if (!event.isTrusted) return; event.stopPropagation();
        try { await send('floating-review-urls', { acceptPartial: !!collectionResult?.unresolved }); }
        catch (error) { note = error.message; render(); }
      });
      choices.append(review);
      if (collectionResult?.unresolved || collectionFailed) {
        const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Review search tab';
        dismiss.addEventListener('click', event => { if (event.isTrusted) { event.stopPropagation(); note = ''; collectionResult = null; collectionFailed = false; render(); } }); choices.append(dismiss);
      }
      feedback.append(choices);
    }
    feedback.hidden = !note; feedback.classList.toggle('error', !!note && !flash);
    if (note) tooltip.hidden = true;
  }
  async function send(type, extra = {}) {
    const result = await ext.runtime.sendMessage({ type, projectId: current?.projectId, ...extra, pageURL: location.href });
    if (!result?.ok) throw new Error(result?.error || 'BootCaT could not complete this action.');
    return result;
  }
  async function command(type) {
    if (!current?.enabled) return;
    try { await send(type); if (type === 'floating-hide') { current = { enabled: false }; remove(); } }
    catch (error) { note = error.message.slice(0, 400); render(); }
  }
  async function perform() {
    if (busy || current?.saved || !current?.enabled) return;
    const token = generation; busy = true; flash = false; note = ''; collectionResult = null; collectionFailed = false; render();
    try {
      const result = await send(current.action === 'collect' ? 'floating-collect' : 'floating-save-page');
      if (token !== generation) return;
      busy = false; flash = !result.unresolved;
      collectionResult = current.action === 'collect' ? result : null;
      note = [collectionResult ? summarize(result) : 'Saved in BootCaT', result.closeWarning || result.workspaceWarning || result.linkWarning || ''].filter(Boolean).join(' ');
      render(); clearTimeout(flashTimer);
      if (current.action !== 'collect' && !result.closeWarning && !result.workspaceWarning && !result.unresolved) flashTimer = setTimeout(() => { flash = false; note = ''; refresh(); }, 1600);
    } catch (error) { if (token === generation) { busy = false; flash = false; collectionFailed = true; note = error.message.slice(0, 400); render(); } }
  }
  async function refresh() {
    const request = ++refreshRevision, requestURL = location.href, requestKey = pageKey();
    try {
      const reply = await ext.runtime.sendMessage({ type: 'get-floating-state', pageURL: location.href });
      if (request !== refreshRevision) return;
      if (location.href !== requestURL || pageKey() !== requestKey) {
        if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 200);
        return;
      }
      if (!reply?.ok) { current = { enabled: false }; remove(); return; }
      const next = reply.state;
      const key = pageKey();
      if (location.href !== documentURL || current?.projectId !== next?.projectId || (observedKey !== undefined && key !== observedKey)) { generation++; busy = flash = false; note = ''; collectionResult = null; collectionFailed = false; clearTimeout(flashTimer); documentURL = location.href; }
      current = next; observedURL = location.href; observedKey = key; render();
    } catch { current = { enabled: false }; remove(); }
  }
  ext.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'bootcat-floating-refresh' || sender.id !== ext.runtime.id) return;
    refresh(); respond?.({ ok: true }); return false;
  });
  new MutationObserver(watchPage).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'class', 'style'] });
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('popstate', refresh); window.addEventListener('hashchange', refresh);
  globalThis.__bootcatFloatingControl = { refresh, get host() { return host; } };
  refresh();
})();
