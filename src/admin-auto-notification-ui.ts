function cleanAdminOrderCreatedModal() {
  document.querySelectorAll<HTMLElement>('.modal').forEach(modal => {
    const copyButton = modal.querySelector('#copyOrderLink');
    const orderId = modal.querySelector('.order-confirm-id');
    if (!copyButton || !orderId) return;

    const paragraphs = Array.from(modal.querySelectorAll<HTMLParagraphElement>('p'));
    const legacy = paragraphs.find(p => /Activepieces|notification turut dimasukkan ke outbox/i.test(p.textContent || ''));
    if (legacy) {
      legacy.textContent = 'Order disimpan. Notifikasi WhatsApp akan dihantar secara automatik melalui queue mengikut status 24 jam customer.';
    }

    const manualWhatsApp = modal.querySelector<HTMLAnchorElement>('a.wa-confirm');
    if (manualWhatsApp) {
      manualWhatsApp.hidden = true;
      manualWhatsApp.removeAttribute('href');
    }

    if (!modal.querySelector('.admin-auto-wa-note')) {
      const note = document.createElement('p');
      note.className = 'admin-auto-wa-note';
      note.innerHTML = '<b>WhatsApp Auto:</b> aktif. Jangan hantar mesej order yang sama secara manual untuk elak duplicate.';
      copyButton.insertAdjacentElement('beforebegin', note);
    }
  });
}

const observer = new MutationObserver(cleanAdminOrderCreatedModal);
observer.observe(document.body, { childList:true, subtree:true });
window.addEventListener('load', cleanAdminOrderCreatedModal);
