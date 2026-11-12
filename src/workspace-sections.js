const sectionIds = ['seeds-section', 'search-section', 'urls-section', 'review-section', 'preview-section'];
export function openWorkspaceSection(id) {
  const section = document.getElementById(id);
  const panel = section?.querySelector('details.workspace-panel');
  if (panel) panel.open = true;
}
export function initWorkspaceSections() {
  for (const id of sectionIds) {
    const panel = document.getElementById(id)?.querySelector('details.workspace-panel');
    if (panel) panel.open = false;
  }
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', () => openWorkspaceSection(link.getAttribute('href').slice(1)));
  }
}
