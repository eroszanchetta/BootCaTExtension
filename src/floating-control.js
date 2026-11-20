// Dynamically registered only when enabled for an active project. This isolated
// content script exposes no page-facing commands and never collects on load.
(() => {
  if (window !== window.top || !['text/html', 'application/xhtml+xml'].includes(document.contentType)) return;
  const ext = globalThis.browser ?? globalThis.chrome;
  if (!ext?.runtime) return;
  const previous = globalThis.__bootcatFloatingControl;
  if (previous) { previous.refresh(); return; }
  let host, root, primary, feedback, tooltip, current, busy = false, flash = false, note = '', refreshRevision = 0, generation = 0, flashTimer;
  let documentURL = location.href;
  const paths = {
    collect: ['M5 4h14v4H5zM5 11h14M5 16h9M5 21h14', 'm16 15 3 3 3-3m-3-4v7'],
    capture: ['M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6'],
    workspace: ['M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z'],
    hide: ['m6 6 12 12M18 6 6 18'],
    saved: ['m5 12 4 4L20 5'],
    busy: ['M12 3a9 9 0 1 1-9 9']
  };
  function icon(button, kind) {
    button.replaceChildren();
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
    sheet.replaceSync(`:host{color-scheme:light}*{box-sizing:border-box}.strip{position:relative;display:flex;gap:3px;padding:4px;background:#fff;border:1px solid #8daebf;border-radius:10px;box-shadow:0 2px 12px #17394c35;color:#006e98;font:13px/1.4 system-ui,sans-serif}button{display:grid;place-items:center;width:32px;height:32px;padding:5px;border:0;border-radius:6px;background:#eef6fa;color:inherit;cursor:pointer}button:hover{background:#d4eaf4}button:focus-visible{outline:3px solid #005e83;outline-offset:1px}button:disabled{cursor:default;opacity:.55}.bubble{position:absolute;right:0;top:calc(100% + 7px);width:max-content;max-width:min(280px,calc(100vw - 32px));padding:8px 10px;border:1px solid #8daebf;border-radius:8px;box-shadow:0 2px 10px #17394c25;background:#fff;color:#24323b;white-space:normal;overflow-wrap:anywhere}.bottom .bubble{top:auto;bottom:calc(100% + 7px)}.left .bubble{right:auto;left:0}.error{border-color:#a22d25;color:#87352e}.spin{animation:turn 1s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}[hidden]{display:none!important}`);
    // Firefox ESR 140 requires an array in the page realm for this DOM setter.
    // Clone only the array of native stylesheet reflectors; never export functions.
    root.adoptedStyleSheets = typeof cloneInto === 'function' ? cloneInto([sheet], document.defaultView, { wrapReflectors: true }) : [sheet];
    const strip = document.createElement('div'); strip.className = 'strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'BootCaT collection controls');
    tooltip = document.createElement('div'); tooltip.id = 'bootcat-floating-tooltip'; tooltip.className = 'bubble'; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true;
    feedback = document.createElement('div'); feedback.className = 'bubble'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.hidden = true;
    primary = button('capture', 'Add this page to corpus', perform);
    strip.append(primary, button('workspace', 'Open BootCaT', () => command('floating-open-workspace')), button('hide', 'Hide floating controls', () => command('floating-hide')), tooltip, feedback);
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
    feedback.textContent = note; feedback.hidden = !note; feedback.classList.toggle('error', !!note && !flash);
    if (note) tooltip.hidden = true;
  }
  async function send(type) {
    const result = await ext.runtime.sendMessage({ type, projectId: current?.projectId });
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
    const token = generation; busy = true; flash = false; note = ''; render();
    try {
      const result = await send(current.action === 'collect' ? 'floating-collect' : 'floating-save-page');
      if (token !== generation) return;
      busy = false; flash = !result.unresolved;
      note = result.closeWarning || result.workspaceWarning || (result.unresolved ? `${result.unresolved} links could not be collected. Review this page and try again.` : 'Saved in BootCaT');
      render(); clearTimeout(flashTimer);
      if (!result.closeWarning && !result.workspaceWarning && !result.unresolved) flashTimer = setTimeout(() => { flash = false; note = ''; refresh(); }, 1600);
    } catch (error) { if (token === generation) { busy = false; flash = false; note = error.message.slice(0, 400); render(); } }
  }
  async function refresh() {
    const request = ++refreshRevision;
    try {
      const reply = await ext.runtime.sendMessage({ type: 'get-floating-state' });
      if (request !== refreshRevision) return;
      if (!reply?.ok) { current = { enabled: false }; remove(); return; }
      const next = reply.state;
      if (location.href !== documentURL || current?.projectId !== next?.projectId) { generation++; busy = flash = false; note = ''; clearTimeout(flashTimer); documentURL = location.href; }
      current = next; render();
    } catch { current = { enabled: false }; remove(); }
  }
  ext.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'bootcat-floating-refresh' || sender.id !== ext.runtime.id) return;
    refresh(); respond?.({ ok: true }); return false;
  });
  window.addEventListener('popstate', refresh); window.addEventListener('hashchange', refresh);
  globalThis.__bootcatFloatingControl = { refresh, get host() { return host; } };
  refresh();
})();
