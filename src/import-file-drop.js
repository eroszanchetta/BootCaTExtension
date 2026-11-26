export function containsFiles(transfer) {
  return !!transfer && (Array.from(transfer.types || []).includes('Files') || Array.from(transfer.items || []).some(item => item.kind === 'file') || transfer.files?.length > 0);
}
export function bindImportFileDrop({ button, canImport, onFile, onError }) {
  const clear = () => button.classList.toggle('file-drop-active', false);
  button.addEventListener('dragover', event => {
    event.preventDefault(); event.stopPropagation();
    const ready = !button.disabled && canImport() && containsFiles(event.dataTransfer);
    button.classList.toggle('file-drop-active', !!ready);
    if (event.dataTransfer) event.dataTransfer.dropEffect = ready ? 'copy' : 'none';
  });
  button.addEventListener('dragleave', event => { if (!button.contains?.(event.relatedTarget)) clear(); });
  button.addEventListener('dragend', clear);
  button.addEventListener('drop', async event => {
    event.preventDefault(); event.stopPropagation(); clear();
    if (button.disabled || !canImport()) { onError('Wait for this document to finish processing.', 'warning'); return; }
    const transfer = event.dataTransfer, files = Array.from(transfer?.files || []);
    const directories = Array.from(transfer?.items || []).some(item => {
      try { return item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory; } catch { return false; }
    });
    if (directories) { onError('Drop a file, not a folder.'); return; }
    if (files.length > 1) { onError('Drop one file at a time.'); return; }
    if (!files.length) { onError('Drop the downloaded file, not a link.'); return; }
    // Ignore ancillary URL/text metadata when a genuine local File is present.
    try { await onFile(files[0]); }
    catch (error) { onError(`File not imported: ${error.message}`); }
  });
}
export function guardFileDropNavigation({ root, onOutsideDrop }) {
  const over = event => { if (containsFiles(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; } };
  const drop = event => { if (containsFiles(event.dataTransfer)) { event.preventDefault(); onOutsideDrop(event); } };
  root.addEventListener('dragover', over); root.addEventListener('drop', drop);
  return () => { root.removeEventListener?.('dragover', over); root.removeEventListener?.('drop', drop); };
}
