import './customer-address-validation.css';

type CustomerRecord = {
  name?: string;
  address_line1?: string;
  city?: string;
  postcode?: string;
  state?: string;
  phone?: string;
};

type ValidationResult = { ok: true; normalized: CustomerRecord } | { ok: false; message: string; field?: keyof CustomerRecord };

const STATE_ALIASES = new Map<string, string>([
  ['johor', 'Johor'],
  ['kedah', 'Kedah'],
  ['kelantan', 'Kelantan'],
  ['melaka', 'Melaka'],
  ['malacca', 'Melaka'],
  ['negeri sembilan', 'Negeri Sembilan'],
  ['pahang', 'Pahang'],
  ['perak', 'Perak'],
  ['perlis', 'Perlis'],
  ['pulau pinang', 'Pulau Pinang'],
  ['penang', 'Pulau Pinang'],
  ['sabah', 'Sabah'],
  ['sarawak', 'Sarawak'],
  ['selangor', 'Selangor'],
  ['terengganu', 'Terengganu'],
  ['kuala lumpur', 'Kuala Lumpur'],
  ['wilayah persekutuan kuala lumpur', 'Kuala Lumpur'],
  ['labuan', 'Labuan'],
  ['wilayah persekutuan labuan', 'Labuan'],
  ['putrajaya', 'Putrajaya'],
  ['wilayah persekutuan putrajaya', 'Putrajaya'],
]);

const STATE_NAMES = Array.from(new Set(STATE_ALIASES.values()));

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function alphaCount(value: unknown) {
  return (cleanText(value).match(/[A-Za-zÀ-ž]/g) || []).length;
}

function wordCount(value: unknown) {
  return cleanText(value).split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

function normalizeMalaysiaPhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.startsWith('60')
    ? digits
    : digits.startsWith('0')
      ? `60${digits.slice(1)}`
      : digits.startsWith('1')
        ? `60${digits}`
        : '';
  return /^601\d{8,9}$/.test(normalized) ? `+${normalized}` : '';
}

function canonicalState(value: unknown) {
  return STATE_ALIASES.get(cleanText(value).toLowerCase()) || '';
}

function validateCustomer(raw: CustomerRecord, pickup: boolean): ValidationResult {
  const normalized: CustomerRecord = {
    name: cleanText(raw.name),
    address_line1: pickup ? '' : cleanText(raw.address_line1),
    city: pickup ? '' : cleanText(raw.city),
    postcode: pickup ? '' : String(raw.postcode ?? '').replace(/\D/g, '').slice(0, 5),
    state: pickup ? '' : canonicalState(raw.state),
    phone: normalizeMalaysiaPhone(raw.phone),
  };

  if (alphaCount(normalized.name) < 3) {
    return { ok: false, message: 'Nama mesti ada sekurang-kurangnya 3 huruf.', field: 'name' };
  }
  if (!normalized.phone) {
    return { ok: false, message: 'Masukkan nombor WhatsApp Malaysia yang sah.', field: 'phone' };
  }
  if (pickup) return { ok: true, normalized };

  if (cleanText(normalized.address_line1).length < 10 || wordCount(normalized.address_line1) < 3) {
    return { ok: false, message: 'Alamat terlalu ringkas. Isi alamat penuh minimum 3 perkataan.', field: 'address_line1' };
  }
  if (cleanText(normalized.address_line1).length > 130) {
    return { ok: false, message: 'Alamat maksimum 130 aksara untuk AWB.', field: 'address_line1' };
  }
  if (alphaCount(normalized.city) < 2) {
    return { ok: false, message: 'Bandar mesti nama sebenar, bukan 1 huruf.', field: 'city' };
  }
  if (!/^\d{5}$/.test(normalized.postcode || '') || normalized.postcode === '00000') {
    return { ok: false, message: 'Poskod mesti tepat 5 digit yang sah.', field: 'postcode' };
  }
  if (!normalized.state) {
    return { ok: false, message: 'Pilih negeri Malaysia yang sah.', field: 'state' };
  }

  return { ok: true, normalized };
}

function isPickupSelected() {
  const active = document.querySelector<HTMLElement>('.shipping-option.active');
  const value = cleanText(active?.dataset.d || active?.textContent).toLowerCase();
  return value.includes('pickup');
}

function readStoredCustomer(): CustomerRecord | null {
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of ['customer_profile', 'customer']) {
      try {
        const parsed = JSON.parse(storage.getItem(key) || 'null');
        if (parsed && typeof parsed === 'object') return parsed as CustomerRecord;
      } catch {
        // Ignore malformed old browser data and force the form to reopen.
      }
    }
  }
  return null;
}

function writeNormalizedCustomer(customer: CustomerRecord) {
  for (const [storage, key] of [[localStorage, 'customer_profile'], [sessionStorage, 'customer']] as const) {
    try {
      const existing = JSON.parse(storage.getItem(key) || '{}');
      storage.setItem(key, JSON.stringify({ ...existing, ...customer }));
    } catch {
      storage.setItem(key, JSON.stringify(customer));
    }
  }
}

function announce(message: string) {
  document.querySelector('.address-validation-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'address-validation-toast';
  toast.role = 'alert';
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function showFormError(form: HTMLFormElement, result: Extract<ValidationResult, { ok: false }>) {
  let error = form.querySelector<HTMLElement>('.address-validation-error');
  if (!error) {
    error = document.createElement('div');
    error.className = 'address-validation-error';
    error.role = 'alert';
    form.prepend(error);
  }
  error.textContent = result.message;
  const field = result.field ? form.elements.namedItem(result.field) : null;
  if (field instanceof HTMLElement) {
    field.focus();
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function applyNormalizedValues(form: HTMLFormElement, customer: CustomerRecord) {
  (Object.entries(customer) as Array<[keyof CustomerRecord, string]>).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.value = value || '';
  });
}

function addStateList(input: HTMLInputElement) {
  if (document.querySelector('#malaysia-state-list')) return;
  const datalist = document.createElement('datalist');
  datalist.id = 'malaysia-state-list';
  datalist.innerHTML = STATE_NAMES.map((state) => `<option value="${state}"></option>`).join('');
  document.body.append(datalist);
  input.setAttribute('list', datalist.id);
}

function enhanceForm(form: HTMLFormElement) {
  if (form.dataset.addressGuarded === '1') return;
  if (!form.elements.namedItem('name') || !form.elements.namedItem('phone')) return;
  form.dataset.addressGuarded = '1';

  const name = form.elements.namedItem('name');
  const phone = form.elements.namedItem('phone');
  const address = form.elements.namedItem('address_line1');
  const city = form.elements.namedItem('city');
  const postcode = form.elements.namedItem('postcode');
  const state = form.elements.namedItem('state');

  if (name instanceof HTMLInputElement) {
    name.minLength = 3;
    name.maxLength = 80;
    name.autocomplete = 'name';
  }
  if (phone instanceof HTMLInputElement) {
    phone.autocomplete = 'tel';
    phone.inputMode = 'tel';
    phone.placeholder = 'Contoh: 0129554732';
  }
  if (address instanceof HTMLInputElement) {
    address.minLength = 10;
    address.maxLength = 130;
    address.autocomplete = 'street-address';
    address.placeholder = 'Contoh: No 12 Jalan Melati Taman Seri';
  }
  if (city instanceof HTMLInputElement) {
    city.minLength = 2;
    city.maxLength = 60;
    city.autocomplete = 'address-level2';
    city.placeholder = 'Contoh: Pasir Puteh';
  }
  if (postcode instanceof HTMLInputElement) {
    postcode.inputMode = 'numeric';
    postcode.pattern = '\\d{5}';
    postcode.maxLength = 5;
    postcode.autocomplete = 'postal-code';
    postcode.placeholder = 'Contoh: 16800';
    postcode.addEventListener('input', () => {
      postcode.value = postcode.value.replace(/\D/g, '').slice(0, 5);
    });
  }
  if (state instanceof HTMLInputElement) {
    state.autocomplete = 'address-level1';
    state.placeholder = 'Pilih negeri';
    addStateList(state);
    state.addEventListener('blur', () => {
      const canonical = canonicalState(state.value);
      if (canonical) state.value = canonical;
    });
  }
}

function reopenAddressEditor() {
  const button = document.querySelector<HTMLButtonElement>('#editCustomer, #openCustomer');
  window.setTimeout(() => button?.click(), 0);
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.elements.namedItem('name') || !form.elements.namedItem('phone')) return;

  const pickup = !form.elements.namedItem('address_line1');
  const data = new FormData(form);
  const result = validateCustomer({
    name: String(data.get('name') || ''),
    address_line1: String(data.get('address_line1') || ''),
    city: String(data.get('city') || ''),
    postcode: String(data.get('postcode') || ''),
    state: String(data.get('state') || ''),
    phone: String(data.get('phone') || ''),
  }, pickup);

  if (!result.ok) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showFormError(form, result);
    announce(result.message);
    return;
  }

  applyNormalizedValues(form, result.normalized);
}, true);

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (!button || !['wa', 'confirmPlaceOrder'].includes(button.id)) return;

  const customer = readStoredCustomer();
  const result = customer ? validateCustomer(customer, isPickupSelected()) : { ok: false as const, message: 'Isi maklumat customer dahulu.' };
  if (!result.ok) {
    event.preventDefault();
    event.stopImmediatePropagation();
    button.closest('.modal-wrap')?.remove();
    announce(result.message);
    reopenAddressEditor();
    return;
  }

  writeNormalizedCustomer(result.normalized);
}, true);

const observer = new MutationObserver(() => {
  document.querySelectorAll<HTMLFormElement>('form').forEach(enhanceForm);
});
observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
document.querySelectorAll<HTMLFormElement>('form').forEach(enhanceForm);
