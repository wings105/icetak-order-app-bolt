type SecureAddressValidation = {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  state: string;
};

const VALID_STATES = new Set([
  'Johor','Kedah','Kelantan','Melaka','Negeri Sembilan','Pahang','Perak','Perlis',
  'Pulau Pinang','Sabah','Sarawak','Selangor','Terengganu','Kuala Lumpur','Labuan','Putrajaya',
]);

const STATE_ALIASES = new Map<string, string>([
  ['johor','Johor'],['kedah','Kedah'],['kelantan','Kelantan'],['melaka','Melaka'],['malacca','Melaka'],
  ['negeri sembilan','Negeri Sembilan'],['pahang','Pahang'],['perak','Perak'],['perlis','Perlis'],
  ['pulau pinang','Pulau Pinang'],['penang','Pulau Pinang'],['sabah','Sabah'],['sarawak','Sarawak'],
  ['selangor','Selangor'],['terengganu','Terengganu'],['kuala lumpur','Kuala Lumpur'],
  ['wilayah persekutuan kuala lumpur','Kuala Lumpur'],['labuan','Labuan'],
  ['wilayah persekutuan labuan','Labuan'],['putrajaya','Putrajaya'],
  ['wilayah persekutuan putrajaya','Putrajaya'],
]);

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function alphaCount(value: unknown) {
  return (clean(value).match(/[A-Za-zÀ-ž]/g) || []).length;
}
function wordCount(value: unknown) {
  return clean(value).split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}
function normalizePhone(value: unknown) {
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
function normalizeState(value: unknown) {
  return STATE_ALIASES.get(clean(value).toLowerCase()) || '';
}
function showError(form: HTMLFormElement, message: string, fieldName: string) {
  let error = form.querySelector<HTMLElement>('.address-validation-error');
  if (!error) {
    error = document.createElement('div');
    error.className = 'address-validation-error';
    error.role = 'alert';
    form.prepend(error);
  }
  error.textContent = message;
  const field = form.elements.namedItem(fieldName);
  if (field instanceof HTMLElement) {
    field.focus();
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
function validate(data: SecureAddressValidation) {
  if (alphaCount(data.recipientName) < 3) return ['Nama penerima mesti ada sekurang-kurangnya 3 huruf.', 'recipientName'] as const;
  if (!data.phone) return ['Masukkan nombor telefon Malaysia yang sah.', 'phone'] as const;
  if (data.addressLine1.length < 10 || wordCount(data.addressLine1) < 3) return ['Alamat terlalu ringkas. Isi alamat penuh minimum 3 perkataan.', 'addressLine1'] as const;
  if (data.addressLine1.length > 130) return ['Alamat maksimum 130 aksara untuk AWB.', 'addressLine1'] as const;
  if (alphaCount(data.city) < 2) return ['Bandar mesti nama sebenar, bukan 1 huruf.', 'city'] as const;
  if (!/^\d{5}$/.test(data.postcode) || data.postcode === '00000') return ['Poskod mesti tepat 5 digit yang sah.', 'postcode'] as const;
  if (!VALID_STATES.has(data.state)) return ['Pilih negeri Malaysia yang sah.', 'state'] as const;
  return null;
}
function enhance(form: HTMLFormElement) {
  if (form.dataset.secureAddressGuarded === '1') return;
  if (!form.matches('[data-ca-address-form]')) return;
  form.dataset.secureAddressGuarded = '1';
  const line1 = form.elements.namedItem('addressLine1');
  const postcode = form.elements.namedItem('postcode');
  if (line1 instanceof HTMLInputElement) {
    line1.minLength = 10;
    line1.maxLength = 130;
    line1.autocomplete = 'street-address';
    line1.placeholder = 'Contoh: No 12 Jalan Melati Taman Seri';
  }
  if (postcode instanceof HTMLInputElement) {
    postcode.inputMode = 'numeric';
    postcode.maxLength = 5;
    postcode.pattern = '\\d{5}';
    postcode.addEventListener('input', () => {
      postcode.value = postcode.value.replace(/\D/g, '').slice(0, 5);
    });
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-ca-address-form]')) return;
  const fields = new FormData(form);
  const normalized: SecureAddressValidation = {
    recipientName: clean(fields.get('recipientName')),
    phone: normalizePhone(fields.get('phone')),
    addressLine1: clean(fields.get('addressLine1')),
    addressLine2: clean(fields.get('addressLine2')),
    city: clean(fields.get('city')),
    postcode: String(fields.get('postcode') ?? '').replace(/\D/g, '').slice(0, 5),
    state: normalizeState(fields.get('state')),
  };
  const failure = validate(normalized);
  if (failure) {
    event.preventDefault();
    event.stopImmediatePropagation();
    showError(form, failure[0], failure[1]);
    return;
  }
  (Object.entries(normalized) as Array<[keyof SecureAddressValidation, string]>).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
  });
}, true);

const observer = new MutationObserver(() => {
  document.querySelectorAll<HTMLFormElement>('[data-ca-address-form]').forEach(enhance);
});
observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll<HTMLFormElement>('[data-ca-address-form]').forEach(enhance);
