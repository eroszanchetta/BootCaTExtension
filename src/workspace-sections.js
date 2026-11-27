const sectionIds = ['project-section', 'seeds-section', 'search-section', 'urls-section', 'review-section'];
export function openWorkspaceSection(id, { scroll = false } = {}) {
  const section = document.getElementById(id);
  const panel = section?.querySelector('details.workspace-panel');
  if (panel) {
    panel.open = true;
    if (scroll) {
      // Let disclosure layout and the sticky menu's ResizeObserver settle first.
      // Automatic collection navigation must not be interrupted by another
      // smooth scroll when closed tabs restore focus to the workspace.
      const reveal = () => { if (panel.open && section.isConnected !== false) section.scrollIntoView({ block: 'start', behavior: 'instant' }); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(reveal));
      else reveal();
    }
  }
}
export function initWorkspaceSections() {
  // The icon menu can wrap; keep anchored sections below its actual height.
  if (typeof ResizeObserver === 'function') {
    const bar = document.querySelector('.workspace-header') || document.querySelector('.topbar');
    if (bar) new ResizeObserver(() => document.documentElement.style.setProperty('--workspace-nav-offset', `${Math.ceil(bar.getBoundingClientRect().height) + 16}px`)).observe(bar);
  }
  for (const id of sectionIds) {
    const panel = document.getElementById(id)?.querySelector('details.workspace-panel');
    if (panel) panel.open = id === 'project-section';
  }
  for (const panel of document.querySelectorAll('details[data-default-collapsed]')) panel.open = false;
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', () => openWorkspaceSection(link.getAttribute('href').slice(1)));
  }
}

export function setProjectSectionState(active) {
  const panel = document.getElementById('project-section')?.querySelector('details.workspace-panel');
  if (panel) panel.open = true;
}

export function scrollWorkspaceTarget(id) {
  const target = document.getElementById(id);
  const reveal = () => { if (target && target.isConnected !== false) target.scrollIntoView({block:'start',behavior:'instant'}); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(reveal));
  else reveal();
}
