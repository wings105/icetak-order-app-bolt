function guardConnectionSettings() {
  const form = document.querySelector<HTMLFormElement>('#wf5Settings');
  const input = form?.querySelector<HTMLInputElement>('input[name="base_url"]');
  if (!form || !input) return;
  input.readOnly = true;
  input.title = 'Managed gateway. Do not change this URL.';
  input.style.background = '#f1f5f9';
  const label = input.closest('label');
  if (label && !label.querySelector('.wf-gateway-note')) {
    const note = document.createElement('small');
    note.className = 'wf-gateway-note';
    note.textContent = ' Managed gateway 🔒';
    note.style.color = '#166534';
    label.insertBefore(note, input);
  }
}

setInterval(guardConnectionSettings, 1800);
window.addEventListener('focus', guardConnectionSettings);
