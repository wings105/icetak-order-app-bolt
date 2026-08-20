const ICETAK_SUPABASE_URL = 'https://buivecgahhmrhlmfujgt.supabase.co';
const COUNTER_QR_BUTTON_ID = 'icetak-counter-qr-btn';
const COUNTER_QR_BOX_ID = 'icetak-counter-qr-box';

function getAccessToken() {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) || '';
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
      if (token) return String(token);
    } catch { /* ignore unrelated storage */ }
  }
  return '';
}

async function counterQrRequest(action, orderRef) {
  const token = getAccessToken();
  if (!token) throw new Error('Admin session tidak dijumpai. Refresh dan login semula.');
  const response = await fetch(`${ICETAK_SUPABASE_URL}/functions/v1/admin-counter-qr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, order_ref: orderRef }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Counter QR HTTP ${response.status}`);
  return payload?.data || {};
}

function money(value) {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function localTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return String(value); }
}

function renderCounterQr(card, data) {
  let box = card.querySelector(`#${COUNTER_QR_BOX_ID}`);
  if (!box) {
    box = document.createElement('div');
    box.id = COUNTER_QR_BOX_ID;
    box.style.marginTop = '10px';
    box.style.padding = '12px';
    box.style.border = '1px solid #abefc6';
    box.style.background = '#ecfdf3';
    box.style.borderRadius = '9px';
    box.style.color = '#05603a';
    card.appendChild(box);
  }
  const expected = Number(data?.expected_amount || 0);
  const base = Number(data?.base_amount || expected || 0);
  const matched = data?.matched === true || data?.status === 'matched';
  box.innerHTML = '';
  const title = document.createElement('b');
  title.textContent = matched ? '✓ QR payment matched' : `QR at Counter active · Pay exactly ${money(expected)}`;
  box.appendChild(title);
  const note = document.createElement('div');
  note.style.marginTop = '5px';
  note.style.fontSize = '12px';
  note.textContent = matched
    ? `Transaction ${data?.transaction_id || ''} sudah matched ke order ini.`
    : `${Math.abs(base - expected) >= 0.001 ? `Order total ${money(base)} · unique match amount ${money(expected)}. ` : ''}Guna QR DuitNow biasa. Session tamat ${localTime(data?.expires_at)}.`;
  box.appendChild(note);
  if (!matched && expected > 0) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-outline btn-sm';
    copy.style.marginTop = '8px';
    copy.textContent = 'Copy Amount';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(expected.toFixed(2));
      copy.textContent = 'Copied ✓';
      setTimeout(() => { copy.textContent = 'Copy Amount'; }, 1500);
    };
    box.appendChild(copy);
  }
}

async function loadExisting(card, orderRef) {
  if (card.dataset.counterQrLoaded === orderRef) return;
  card.dataset.counterQrLoaded = orderRef;
  try {
    const data = await counterQrRequest('status', orderRef);
    if (data?.active || data?.matched) renderCounterQr(card, data);
  } catch { /* status is optional; button still works */ }
}

function enhanceCounterQr() {
  const drawer = document.querySelector('.erp-order-drawer');
  if (!drawer) return;
  const orderRef = drawer.querySelector('.erp-drawer-title h2')?.textContent?.trim() || '';
  if (!orderRef) return;
  const cards = [...drawer.querySelectorAll('.erp-drawer-card')];
  const card = cards.find((node) => node.querySelector('h3')?.textContent?.trim() === 'Payment Summary');
  if (!card) return;
  const actions = card.querySelector('.erp-card-actions');
  if (!actions) return;
  const cashButton = [...actions.querySelectorAll('button')].find((button) => button.textContent?.includes('Confirm Cash Paid'));
  if (!cashButton) return;

  if (!actions.querySelector(`#${COUNTER_QR_BUTTON_ID}`)) {
    const button = document.createElement('button');
    button.id = COUNTER_QR_BUTTON_ID;
    button.type = 'button';
    button.className = 'btn btn-outline btn-sm';
    button.textContent = 'Pay QR at Counter';
    button.onclick = async () => {
      const confirmed = window.confirm(`Prepare QR payment untuk ${orderRef}? Customer perlu bayar amount tepat yang system reserve.`);
      if (!confirmed) return;
      button.disabled = true;
      button.textContent = 'Preparing QR…';
      try {
        const data = await counterQrRequest('prepare', orderRef);
        renderCounterQr(card, data);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
        button.textContent = 'Pay QR at Counter';
      }
    };
    actions.insertBefore(button, cashButton);
  }
  void loadExisting(card, orderRef);
}

const observer = new MutationObserver(() => enhanceCounterQr());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', enhanceCounterQr);
setTimeout(enhanceCounterQr, 800);
