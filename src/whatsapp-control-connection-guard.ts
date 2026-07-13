const PRODUCTION_CUSTOMER_APP_URL = 'https://icetak.bolt.host';

function isUnsafePreviewUrl(value: string) {
  return /(localhost|127\.0\.0\.1|0\.0\.0\.0|webcontainer-api\.io|local-credentialless|\.local(?:\/|$)|bolt\.new)/i.test(value);
}

function guardConnectionSettings() {
  const form = document.querySelector<HTMLFormElement>('#wf5Settings');
  const gatewayInput = form?.querySelector<HTMLInputElement>('input[name="base_url"]');
  const customerAppInput = form?.querySelector<HTMLInputElement>('input[name="customer_app_base_url"]');
  if (!form) return;

  if (gatewayInput) {
    gatewayInput.readOnly = true;
    gatewayInput.title = 'Managed gateway. Do not change this URL.';
    gatewayInput.style.background = '#f1f5f9';
    const label = gatewayInput.closest('label');
    if (label && !label.querySelector('.wf-gateway-note')) {
      const note = document.createElement('small');
      note.className = 'wf-gateway-note';
      note.textContent = ' Managed gateway 🔒';
      note.style.color = '#166534';
      label.insertBefore(note, gatewayInput);
    }
  }

  if (customerAppInput) {
    const current = customerAppInput.value.trim();
    if (!current || isUnsafePreviewUrl(current)) customerAppInput.value = PRODUCTION_CUSTOMER_APP_URL;
    customerAppInput.placeholder = PRODUCTION_CUSTOMER_APP_URL;
    customerAppInput.title = 'Gunakan URL production HTTPS sahaja.';
    const label = customerAppInput.closest('label');
    if (label && !label.querySelector('.wf-production-url-note')) {
      const note = document.createElement('small');
      note.className = 'wf-production-url-note';
      note.textContent = ' Production URL only';
      note.style.color = '#166534';
      label.insertBefore(note, customerAppInput);
    }
  }

  if (form.dataset.productionGuard !== '1') {
    form.dataset.productionGuard = '1';
    form.addEventListener('submit', event => {
      const value = customerAppInput?.value.trim() || '';
      if (!value.startsWith('https://') || isUnsafePreviewUrl(value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (customerAppInput) {
          customerAppInput.value = PRODUCTION_CUSTOMER_APP_URL;
          customerAppInput.focus();
        }
        window.alert('Customer App URL mesti URL production HTTPS. URL preview WebContainer tidak dibenarkan.');
      }
    }, true);
  }
}

setInterval(guardConnectionSettings, 1200);
window.addEventListener('focus', guardConnectionSettings);
window.addEventListener('load', guardConnectionSettings);
