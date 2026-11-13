// One reusable modal keeps confirmations consistent and keyboard accessible.
// Native dialog handles the focus trap, Escape and focus restoration.
export async function confirmAction({ title, message, confirmLabel = 'Continue', destructive = false }) {
  const dialog = document.getElementById('confirmation-dialog');
  if (dialog.open) return false;
  document.getElementById('confirmation-title').textContent = title;
  document.getElementById('confirmation-message').textContent = message;
  const accept = document.getElementById('confirmation-accept');
  accept.textContent = confirmLabel; accept.classList.toggle('danger', destructive);
  dialog.returnValue = 'cancel';
  return new Promise((resolve, reject) => {
    const closed = () => resolve(dialog.returnValue === 'confirm');
    dialog.addEventListener('close', closed, { once: true });
    try {
      dialog.showModal(); document.getElementById('confirmation-cancel').focus();
    } catch (error) { dialog.removeEventListener('close', closed); reject(error); }
  });
}
