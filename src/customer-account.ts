import { supabase } from './appdeploy-client';
import './customer-account.css';

type Address = {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  state: string;
  country: string;
  isDefault: boolean;
  isVerified: boolean;
  isConfirmed: boolean;
  source: string;
  summary: string;
};

type Account = {
  customer: {
    id: string;
    customerToken: string;
    displayName: string;
    phone: string;
    email: string;
    sessionExpiresAt: number;
  };
  addresses: Address[];
};

type CartItem = {
  id: string;
  k: string;
  title: string;
  process: string;
  review?: string;
  size: string;
  style: string;
  customText?: string;
  price: number;
  qty: number;
};

const SHIPPING: Record<string, number> = { pickup: 0, spx: 4.5, jnt: 5.9, ninja: 6.9 };
const STATES = ['Johor','Kedah','Kelantan','Melaka','Negeri Sembilan','Pahang','Perak','Perlis','Pulau Pinang','Sabah','Sarawak','Selangor','Terengganu','Kuala Lumpur','Labuan','Putrajaya'];
let account: Account | null = null;
let loading: Promise<Account | null> | null = null;
let selectedAddressId = sessionStorage.getItem('customer_selected_address_id') || '';
let observerBusy = false;

const sessionValue = () => localStorage.getItem('customer_session') || '';
const legacyCustomerToken = () => new URL(location.href).searchParams.get('c') || localStorage.getItem('customer_token') || '';

function esc(value: unknown) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function money(value: number) { return `RM${Number.isInteger(value) ? value : value.toFixed(2)}`; }
function toast(message: string, bad = false) {
  document.querySelector('.ca-toast')?.remove();
  const el = document.createElement('div');
  el.className = `ca-toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2800);
}
function closeModals() { document.querySelectorAll('.ca-modal-wrap').forEach((node) => node.remove()); }
function modal(html: string, className = '') {
  const wrap = document.createElement('div');
  wrap.className = `ca-modal-wrap ${className}`;
  wrap.innerHTML = `<section class="ca-dialog">${html}</section>`;
  document.body.append(wrap);
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap || (event.target as HTMLElement).closest('[data-ca-close]')) wrap.remove();
  });
  return wrap;
}
async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name as any, args as any);
  if (error) throw new Error(error.message);
  return data as T;
}
function clearSecureSession(clearCustomerToken = false) {
  localStorage.removeItem('customer_session');
  localStorage.removeItem('customer_session_expires_at');
  localStorage.removeItem('customer_profile');
  sessionStorage.removeItem('customer');
  sessionStorage.removeItem('customer_selected_address_id');
  selectedAddressId = '';
  account = null;
  loading = null;
  if (clearCustomerToken) localStorage.removeItem('customer_token');
}
async function loadAccount(force = false) {
  const value = sessionValue();
  if (!value) return null;
  if (account && !force) return account;
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const result = await rpc<Account>('icetak_customer_me', { p_value: value });
      account = result;
      localStorage.removeItem('customer_profile');
      sessionStorage.removeItem('customer');
      const exists = account.addresses.some((address) => address.id === selectedAddressId);
      if (!exists) selectedAddressId = account.addresses.find((address) => address.isDefault)?.id || account.addresses[0]?.id || '';
      if (selectedAddressId) sessionStorage.setItem('customer_selected_address_id', selectedAddressId);
      return account;
    } catch (error) {
      clearSecureSession(false);
      toast(error instanceof Error ? error.message : 'Session tamat', true);
      return null;
    } finally { loading = null; }
  })();
  return loading;
}
function selectedAddress() {
  return account?.addresses.find((address) => address.id === selectedAddressId)
    || account?.addresses.find((address) => address.isDefault)
    || account?.addresses[0]
    || null;
}
function requireSecureLogin() {
  return modal(`<button data-ca-close class="ca-x">×</button><div class="ca-lock">🔐</div><h2>Login semula diperlukan</h2><p>My Orders lama masih boleh dibuka, tetapi profile dan saved address memerlukan session selamat daripada OTP WhatsApp.</p><button data-customer-secure-login class="ca-primary">Login dengan WhatsApp</button>`);
}

function addressCard(address: Address) {
  const imported = !address.isConfirmed;
  return `<article class="ca-address ${address.isDefault ? 'default' : ''}">
    <header><div><b>${esc(address.label || 'Alamat')}</b>${address.isDefault ? '<span>Default</span>' : ''}</div><small>${imported ? 'Alamat lama — sila semak' : 'Disahkan customer'}</small></header>
    <strong>${esc(address.recipientName)}</strong>
    <p>${esc(address.summary)}</p>
    <small>${esc(address.phone)}</small>
    <footer>
      <button data-ca-edit-address="${esc(address.id)}">Edit</button>
      ${address.isDefault ? '' : `<button data-ca-default="${esc(address.id)}">Set Default</button>`}
      <button class="danger" data-ca-archive="${esc(address.id)}">Delete</button>
    </footer>
  </article>`;
}

async function openProfile() {
  const current = await loadAccount(true);
  if (!current) { requireSecureLogin(); return; }
  const wrap = modal('<div class="ca-loading">Loading profile…</div>', 'ca-profile-wrap');
  renderProfile(wrap);
}
function renderProfile(wrap: HTMLElement) {
  if (!account) { wrap.remove(); return; }
  const dialog = wrap.querySelector<HTMLElement>('.ca-dialog')!;
  dialog.innerHTML = `<button data-ca-close class="ca-x">×</button>
    <header class="ca-profile-head"><div class="ca-avatar">${esc(account.customer.displayName.slice(0,1).toUpperCase())}</div><div><small>My Profile</small><h2>${esc(account.customer.displayName)}</h2><span>${esc(account.customer.phone)}</span></div></header>
    <section class="ca-profile-summary"><div><span>Name</span><b>${esc(account.customer.displayName)}</b></div><div><span>Email</span><b>${esc(account.customer.email || 'Belum ditambah')}</b></div><button data-ca-edit-profile>Edit Profile</button></section>
    <section class="ca-address-section"><header><div><h3>My Addresses</h3><small>${account.addresses.length} alamat disimpan</small></div><button data-ca-add-address>＋ Add Address</button></header>
    <div class="ca-address-list">${account.addresses.length ? account.addresses.map(addressCard).join('') : '<div class="ca-empty-address"><b>Belum ada saved address</b><p>Tambah address untuk checkout lebih cepat.</p></div>'}</div></section>
    <section class="ca-session-actions"><button data-ca-logout>Logout This Device</button><button class="danger" data-ca-logout-all>Logout All Devices</button></section>`;
  bindProfileEvents(wrap);
}
function bindProfileEvents(wrap: HTMLElement) {
  wrap.querySelector<HTMLButtonElement>('[data-ca-edit-profile]')!.onclick = () => openProfileForm(wrap);
  wrap.querySelector<HTMLButtonElement>('[data-ca-add-address]')!.onclick = () => openAddressForm(null, () => renderProfile(wrap));
  wrap.querySelectorAll<HTMLButtonElement>('[data-ca-edit-address]').forEach((button) => {
    button.onclick = () => openAddressForm(account!.addresses.find((address) => address.id === button.dataset.caEditAddress) || null, () => renderProfile(wrap));
  });
  wrap.querySelectorAll<HTMLButtonElement>('[data-ca-default]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await rpc<{ account: Account }>('icetak_customer_address_default', { p_value: sessionValue(), p_address_id: button.dataset.caDefault });
        account = result.account;
        selectedAddressId = button.dataset.caDefault || '';
        sessionStorage.setItem('customer_selected_address_id', selectedAddressId);
        renderProfile(wrap); enhanceCheckout(); toast('Default address updated');
      } catch (error) { button.disabled = false; toast(error instanceof Error ? error.message : 'Gagal update default', true); }
    };
  });
  wrap.querySelectorAll<HTMLButtonElement>('[data-ca-archive]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm('Delete saved address ini? Order lama tidak akan berubah.')) return;
      button.disabled = true;
      try {
        const result = await rpc<{ account: Account }>('icetak_customer_address_archive_rpc', { p_value: sessionValue(), p_address_id: button.dataset.caArchive });
        account = result.account;
        if (!account.addresses.some((address) => address.id === selectedAddressId)) selectedAddressId = account.addresses.find((address) => address.isDefault)?.id || account.addresses[0]?.id || '';
        renderProfile(wrap); enhanceCheckout(); toast('Address deleted');
      } catch (error) { button.disabled = false; toast(error instanceof Error ? error.message : 'Gagal delete address', true); }
    };
  });
  wrap.querySelector<HTMLButtonElement>('[data-ca-logout]')!.onclick = () => void logout(false);
  wrap.querySelector<HTMLButtonElement>('[data-ca-logout-all]')!.onclick = () => void logout(true);
}
function openProfileForm(parent: HTMLElement) {
  if (!account) return;
  const wrap = modal(`<button data-ca-close class="ca-x">×</button><h2>Edit Profile</h2><form class="ca-form" data-ca-profile-form>
    <label>Nama<input name="display_name" required maxlength="120" value="${esc(account.customer.displayName)}"></label>
    <label>Email (optional)<input name="email" type="email" maxlength="160" value="${esc(account.customer.email)}"></label>
    <label>Nombor WhatsApp<input value="${esc(account.customer.phone)}" disabled><small>Phone telah disahkan melalui WhatsApp. Tukar nombor perlukan verification berasingan.</small></label>
    <button class="ca-primary">Save Profile</button></form>`);
  wrap.querySelector<HTMLFormElement>('[data-ca-profile-form]')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    const data = new FormData(form);
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await rpc<{ account: Account }>('icetak_customer_profile_update', { p_value: sessionValue(), p_display_name: String(data.get('display_name') || ''), p_email: String(data.get('email') || '') });
      account = result.account;
      wrap.remove(); renderProfile(parent); enhanceCheckout(); toast('Profile updated');
    } catch (error) { button.disabled = false; button.textContent = 'Save Profile'; toast(error instanceof Error ? error.message : 'Gagal save profile', true); }
  };
}
function openAddressForm(existing: Address | null, afterSave?: () => void) {
  if (!account) return;
  const address = existing || {
    id:'', label:'Rumah', recipientName:account.customer.displayName, phone:account.customer.phone,
    addressLine1:'', addressLine2:'', city:'', postcode:'', state:'Kelantan', country:'Malaysia',
    isDefault:account.addresses.length === 0, isVerified:true, isConfirmed:true, source:'customer_portal', summary:'',
  };
  const wrap = modal(`<button data-ca-close class="ca-x">×</button><h2>${existing ? 'Edit Address' : 'Add New Address'}</h2><form class="ca-form" data-ca-address-form>
    <div class="ca-two"><label>Label<select name="label">${['Rumah','Tempat Kerja','Keluarga','Lain-lain'].map((label) => `<option ${address.label === label ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Recipient Name<input name="recipientName" required maxlength="120" value="${esc(address.recipientName)}"></label></div>
    <label>Recipient Phone<input name="phone" inputmode="tel" required value="${esc(address.phone)}"></label>
    <label>Address Line 1<input name="addressLine1" required maxlength="220" value="${esc(address.addressLine1)}"></label>
    <label>Address Line 2 (optional)<input name="addressLine2" maxlength="220" value="${esc(address.addressLine2)}"></label>
    <div class="ca-two"><label>City<input name="city" required maxlength="100" value="${esc(address.city)}"></label><label>Postcode<input name="postcode" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required value="${esc(address.postcode)}"></label></div>
    <label>State<select name="state">${STATES.map((state) => `<option ${address.state === state ? 'selected' : ''}>${state}</option>`).join('')}</select></label>
    <label class="ca-check"><input type="checkbox" name="isDefault" ${address.isDefault ? 'checked' : ''}><span>Set as default address</span></label>
    <button class="ca-primary">${existing ? 'Save Changes' : 'Save Address'}</button></form>`);
  wrap.querySelector<HTMLFormElement>('[data-ca-address-form]')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries()) as Record<string, unknown>;
    payload.isDefault = data.get('isDefault') === 'on';
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const result = await rpc<{ account: Account; address_id: string }>('icetak_customer_address_save', { p_value: sessionValue(), p_payload: payload, p_address_id: existing?.id || null });
      account = result.account;
      selectedAddressId = result.address_id;
      sessionStorage.setItem('customer_selected_address_id', selectedAddressId);
      wrap.remove(); afterSave?.(); enhanceCheckout(); toast(existing ? 'Address updated' : 'Address saved');
    } catch (error) { button.disabled = false; button.textContent = existing ? 'Save Changes' : 'Save Address'; toast(error instanceof Error ? error.message : 'Gagal save address', true); }
  };
}
async function logout(all: boolean) {
  if (all && !confirm('Logout semua device yang pernah login?')) return;
  try { await rpc('icetak_customer_logout', { p_value: sessionValue(), p_all: all }); } catch { /* local logout still proceeds */ }
  clearSecureSession(true);
  closeModals();
  const url = new URL(location.href);
  ['c','order','login','magic_token','token'].forEach((key) => url.searchParams.delete(key));
  location.replace(url.origin + url.pathname);
}

async function openAddressSelector() {
  const current = await loadAccount();
  if (!current) { requireSecureLogin(); return; }
  const wrap = modal(`<button data-ca-close class="ca-x">×</button><h2>Select Delivery Address</h2><div class="ca-selector-list">
    ${current.addresses.length ? current.addresses.map((address) => `<button data-ca-select-address="${esc(address.id)}" class="${address.id === selectedAddressId ? 'selected' : ''}"><div><b>${esc(address.label)}${address.isDefault ? ' • Default' : ''}</b><strong>${esc(address.recipientName)}</strong><span>${esc(address.summary)}</span></div><i>${address.id === selectedAddressId ? '✓' : '›'}</i></button>`).join('') : '<div class="ca-empty-address"><b>Belum ada saved address</b></div>'}
    <button data-ca-add-from-selector class="ca-add-selector">＋ Add New Address</button></div>`);
  wrap.querySelectorAll<HTMLButtonElement>('[data-ca-select-address]').forEach((button) => {
    button.onclick = () => {
      selectedAddressId = button.dataset.caSelectAddress || '';
      sessionStorage.setItem('customer_selected_address_id', selectedAddressId);
      wrap.remove(); enhanceCheckout(); toast('Delivery address selected');
    };
  });
  wrap.querySelector<HTMLButtonElement>('[data-ca-add-from-selector]')!.onclick = () => openAddressForm(null, () => { wrap.remove(); });
}
function checkoutShipping() {
  return document.querySelector<HTMLButtonElement>('.shipping-option.active[data-d]')?.dataset.d || 'pickup';
}
function enhanceCheckout() {
  const main = document.querySelector<HTMLElement>('main.checkout');
  if (!main || !sessionValue() || !account) return;
  const card = main.querySelector<HTMLButtonElement>('.address-card');
  if (!card) return;
  const shipping = checkoutShipping();
  if (shipping === 'pickup') {
    card.id = 'editCustomer';
    card.dataset.caSecure = '1';
    card.innerHTML = `<span>👤</span><div><b>${esc(account.customer.displayName)} <small>${esc(account.customer.phone)}</small></b><p>Pickup — Bandar Baru Pasir Puteh</p></div><i>›</i>`;
  } else {
    const address = selectedAddress();
    card.id = address ? 'editCustomer' : 'openCustomer';
    card.dataset.caSecure = '1';
    card.classList.toggle('empty-address', !address);
    card.innerHTML = address
      ? `<span>📍</span><div><b>${esc(address.label)}${address.isDefault ? ' <small>Default</small>' : ''}</b><p>${esc(address.recipientName)} • ${esc(address.summary)}</p></div><i>›</i>`
      : `<span>📍</span><div><b>Add delivery address</b><p>Saved address diperlukan untuk courier checkout</p></div><i>›</i>`;
  }
  if (!main.querySelector('[data-ca-checkout-profile]')) {
    const profile = document.createElement('button');
    profile.type = 'button';
    profile.dataset.caCheckoutProfile = '1';
    profile.className = 'ca-checkout-profile';
    profile.textContent = '👤 Profile & Addresses';
    card.insertAdjacentElement('afterend', profile);
  }
}
function injectProfileButtons() {
  if (!sessionValue()) return;
  const hero = document.querySelector<HTMLElement>('.cp-history-hero,.history-hero');
  if (hero && !hero.querySelector('[data-ca-open-profile]')) {
    const button = document.createElement('button');
    button.dataset.caOpenProfile = '1';
    button.className = 'ca-profile-chip';
    button.textContent = '👤 Profile';
    hero.append(button);
  }
}
async function beginLoggedCheckout() {
  const current = await loadAccount();
  if (!current) { requireSecureLogin(); return; }
  const cart = JSON.parse(localStorage.getItem('cart') || '[]') as CartItem[];
  if (!cart.length) { toast('Cart masih kosong', true); return; }
  const shipping = checkoutShipping();
  const address = selectedAddress();
  if (shipping !== 'pickup' && !address) { await openAddressSelector(); return; }
  const date = document.querySelector<HTMLInputElement>('#date')?.value || sessionStorage.getItem('need_date') || '';
  if (!date) { toast('Pilih Date Need dahulu', true); document.querySelector<HTMLInputElement>('#date')?.focus(); return; }
  const payment = shipping === 'pickup' ? document.querySelector<HTMLButtonElement>('.pay-option.active[data-p]')?.dataset.p || 'QR Pay' : 'QR Pay';
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const total = subtotal + (SHIPPING[shipping] || 0);
  const itemHtml = cart.map((item) => `<article><div><b>${item.qty}× ${esc(item.title)}</b><span>${esc(item.size)} • ${esc(item.style)}</span></div><strong>${money(item.price * item.qty)}</strong></article>`).join('');
  const wrap = modal(`<button data-ca-close class="ca-x">×</button><h2>Review Order</h2><section class="ca-order-review">
    <div><span>Customer</span><b>${esc(current.customer.displayName)}</b></div>
    <div><span>WhatsApp</span><b>${esc(current.customer.phone)}</b></div>
    <div><span>Date Need</span><b>${esc(date)}</b></div>
    <div><span>${shipping === 'pickup' ? 'Pickup' : 'Delivery'}</span><b>${shipping === 'pickup' ? 'Bandar Baru Pasir Puteh' : esc(address!.summary)}</b></div>
    ${itemHtml}<div class="total"><span>Total</span><b>${money(total)}</b></div></section>
    <label class="ca-check ca-notify"><input type="checkbox" data-ca-notify checked><span>Terima notifikasi WhatsApp untuk status order</span></label>
    <button data-ca-confirm-checkout class="ca-primary">Confirm & Place Order</button><button data-ca-close class="ca-secondary">Back to Edit</button>`);
  wrap.querySelector<HTMLButtonElement>('[data-ca-confirm-checkout]')!.onclick = async () => {
    const button = wrap.querySelector<HTMLButtonElement>('[data-ca-confirm-checkout]')!;
    button.disabled = true; button.textContent = 'Creating…';
    try {
      const result = await rpc<Record<string, any>>('icetak_customer_checkout', {
        p_value: sessionValue(),
        p_payload: { items: cart, date_need: date, delivery: shipping, payment, total, address_id: shipping === 'pickup' ? null : address!.id, consent: true, notify_whatsapp: wrap.querySelector<HTMLInputElement>('[data-ca-notify]')!.checked },
      });
      localStorage.setItem('customer_token', String(result.customer_token || current.customer.customerToken));
      localStorage.setItem('cart', '[]');
      sessionStorage.removeItem('need_date');
      wrap.remove();
      showOrderCreated(result, payment, current.customer.phone);
    } catch (error) { button.disabled = false; button.textContent = 'Confirm & Place Order'; toast(error instanceof Error ? error.message : 'Order gagal disimpan', true); }
  };
}
function cleanOrderUrl(orderToken: string) {
  const url = new URL(location.href);
  ['c','login','magic_token','confirm','token'].forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('order', orderToken);
  return url.toString();
}
function showOrderCreated(result: Record<string, any>, payment: string, phone: string) {
  const orderUrl = cleanOrderUrl(String(result.order_token || ''));
  const confirmUrl = result.confirm_token ? `${location.origin}${location.pathname}?confirm=${encodeURIComponent(result.confirm_token)}` : '';
  const message = result.confirm_token ? `Hi, sila semak dan sahkan order iCetak ${result.order_id}.\n${confirmUrl}` : `Order iCetak ${result.order_id} telah dicipta.\n${orderUrl}`;
  const wrap = modal(`<button data-ca-close class="ca-x">×</button><div class="ca-success">✓</div><h2>Order Created</h2><strong class="ca-order-id">${esc(result.order_id)}</strong><p>${result.confirm_token ? 'Sila confirm order sebelum production.' : payment === 'QR Pay' ? 'Order masuk To Pay sehingga bayaran disahkan.' : 'Order berjaya disimpan.'}</p>
    ${result.confirm_token ? `<a class="ca-primary ca-link" target="_blank" href="https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(message)}">Send Confirmation on WhatsApp</a><a class="ca-secondary ca-link" href="${esc(confirmUrl)}">Confirm Order Now</a>` : '<button data-ca-view-order class="ca-primary">Pay / View Order</button>'}
    <button data-ca-copy-link class="ca-secondary">Copy Tracking Link</button>`);
  wrap.querySelector<HTMLButtonElement>('[data-ca-view-order]')?.addEventListener('click', () => location.assign(orderUrl));
  wrap.querySelector<HTMLButtonElement>('[data-ca-copy-link]')!.onclick = async () => { await navigator.clipboard.writeText(orderUrl); toast('Tracking link copied'); };
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const profile = target.closest('[data-ca-open-profile],[data-ca-checkout-profile]');
  if (profile) { event.preventDefault(); event.stopImmediatePropagation(); void openProfile(); return; }

  const head = target.closest('#headAdmin');
  if (head && (sessionValue() || legacyCustomerToken())) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (sessionValue()) void openProfile(); else requireSecureLogin();
    return;
  }

  const address = target.closest('#openCustomer,#editCustomer');
  if (address && sessionValue()) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (checkoutShipping() === 'pickup') void openProfile(); else void openAddressSelector();
    return;
  }

  const placeOrder = target.closest('#wa');
  if (placeOrder && sessionValue()) {
    event.preventDefault(); event.stopImmediatePropagation();
    void beginLoggedCheckout();
  }
}, true);

function enhance() {
  if (observerBusy) return;
  observerBusy = true;
  queueMicrotask(() => {
    observerBusy = false;
    injectProfileButtons();
    enhanceCheckout();
  });
}
const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList: true, subtree: true });
if (sessionValue()) void loadAccount().then(enhance);
enhance();
