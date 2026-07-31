import { supabase } from './supabase-client';

type SizeOption = { value: string; label?: string; price: number };
type WordingOption = {
  value: string;
  label: string;
  requires_text?: boolean;
  default_text?: string;
  placeholder?: string;
  review_required?: boolean;
};
type ProfileConfig = {
  default_process?: string;
  size_options?: SizeOption[];
  wording_options?: WordingOption[];
};
type CatalogProduct = {
  id: string;
  slug: string;
  display_name: string;
  source_title: string | null;
  description: string | null;
  parent_sku: string | null;
  clickup_task_id: string | null;
  main_image_url: string | null;
  base_price: number | string | null;
  product_order_profiles: {
    code: string;
    product_type: 'printed' | 'edible';
    config: ProfileConfig;
  } | null;
};
type CartItem = {
  id: string;
  k: 'printed' | 'edible';
  title: string;
  process: string;
  review: 'Need Review' | 'No Review';
  size: string;
  style: string;
  customText?: string;
  price: number;
  qty: number;
  product_id?: string;
  product_variant_id?: string | null;
  catalog_slug?: string;
  catalog_clickup_task_id?: string;
  wording_mode?: string;
  customization?: Record<string, unknown>;
  product_snapshot?: Record<string, unknown>;
};
type EditorState = { size: SizeOption; wording: WordingOption; customText: string; qty: number };

const root = document.querySelector<HTMLDivElement>('#app')!;
const productCache = new Map<string, CatalogProduct>();
let enhancingSlug = '';

function esc(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}
function money(value: number) { return `RM${Number.isInteger(value) ? value : value.toFixed(2)}`; }
function currentSlug() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return hash.match(/^product\/(.+)$/)?.[1] || '';
}
function isBasicSlug(slug: string) {
  return ['edible-image', 'burn-away-combo', 'wafer-paper', 'cake-topper', 'mirror-gold-artpaper', 'acrylic-cake-topper'].includes(slug);
}
function readCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('cart') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveCart(items: CartItem[]) { localStorage.setItem('cart', JSON.stringify(items)); }
function normalizeIdentity(value: string) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function cartIdentity(product: CatalogProduct, state: EditorState) {
  return ['catalog', product.id, state.size.value, state.wording.value, normalizeIdentity(state.customText)].join('|');
}
function toast(message: string) {
  const node = document.createElement('div');
  node.className = 'catalog-config-toast';
  node.textContent = message;
  document.body.append(node);
  window.setTimeout(() => node.remove(), 1800);
}
function homeUrl(checkout = false) {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.delete('q');
  url.searchParams.delete('product');
  url.searchParams.delete('catalogAdded');
  url.searchParams.delete('checkout');
  url.searchParams.set(checkout ? 'checkout' : 'catalogAdded', '1');
  return url.toString();
}
async function getProduct(slug: string) {
  const cached = productCache.get(slug);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('products')
    .select('id,slug,display_name,source_title,description,parent_sku,clickup_task_id,main_image_url,base_price,product_order_profiles(code,product_type,config)')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Product not found');
  const row = data as unknown as CatalogProduct;
  productCache.set(slug, row);
  return row;
}
function defaults(product: CatalogProduct, existing?: CartItem): EditorState {
  const profile = product.product_order_profiles;
  if (!profile) throw new Error('Order profile not configured');
  const sizes = profile.config.size_options || [{ value: '1 pc', label: '1 pc', price: Number(product.base_price || 0) }];
  const wording = profile.config.wording_options || [{ value: 'no_wording', label: 'No Wording', requires_text: false, review_required: false }];
  return {
    size: sizes.find((item) => item.value === existing?.size) || sizes[0],
    wording: wording.find((item) => item.value === existing?.wording_mode) || wording[0],
    customText: existing?.customText || wording[0].default_text || '',
    qty: existing?.qty || 1,
  };
}
function buildItem(product: CatalogProduct, state: EditorState): CartItem {
  const profile = product.product_order_profiles!;
  const text = state.wording.requires_text ? state.customText.trim() : (state.wording.default_text || '').trim();
  const reviewRequired = Boolean(state.wording.review_required);
  return {
    id: cartIdentity(product, { ...state, customText: text }),
    k: profile.product_type,
    title: product.display_name,
    process: profile.config.default_process || 'Pre-order',
    review: reviewRequired ? 'Need Review' : 'No Review',
    size: state.size.value,
    style: state.wording.label,
    customText: text,
    price: Number(state.size.price || product.base_price || 0),
    qty: state.qty,
    product_id: product.id,
    product_variant_id: null,
    catalog_slug: product.slug,
    catalog_clickup_task_id: product.clickup_task_id || '',
    wording_mode: state.wording.value,
    customization: {
      size: state.size.value,
      size_label: state.size.label || state.size.value,
      wording_mode: state.wording.value,
      wording_label: state.wording.label,
      custom_text: text,
      review_required: reviewRequired,
    },
    product_snapshot: {
      product_name: product.display_name,
      source_title: product.source_title || product.display_name,
      parent_sku: product.parent_sku || '',
      image_url: product.main_image_url || '',
      catalog_slug: product.slug,
      catalog_clickup_task_id: product.clickup_task_id || '',
      selected_size: state.size.value,
      wording_mode: state.wording.value,
      custom_text: text,
      unit_price: Number(state.size.price || product.base_price || 0),
    },
  };
}
function validate(state: EditorState) {
  return state.wording.requires_text && !state.customText.trim() ? 'Isi nama atau wording dahulu.' : '';
}
function optionsHtml(group: string, values: Array<{ value: string; label?: string }>, current: string) {
  return `<div class="catalog-config-options">${values.map((item) => `<button type="button" data-config-group="${group}" data-config-value="${esc(item.value)}" class="${item.value === current ? 'active' : ''}">${esc(item.label || item.value)}</button>`).join('')}</div>`;
}
function editorMarkup(product: CatalogProduct, state: EditorState, compact = false) {
  const profile = product.product_order_profiles!;
  const sizes = profile.config.size_options || [];
  const wording = profile.config.wording_options || [];
  return `<section class="catalog-configurator ${compact ? 'catalog-configurator-modal' : ''}" data-catalog-editor="${esc(product.slug)}">
    <header><div><small>Pilihan tempahan</small><h3>${esc(product.display_name)}</h3></div><strong data-config-price>${money(Number(state.size.price || product.base_price || 0))}</strong></header>
    ${sizes.length > 1 ? `<h4>Saiz</h4>${optionsHtml('size', sizes, state.size.value)}` : `<div class="catalog-config-single"><span>Saiz</span><b>${esc(state.size.label || state.size.value)}</b></div>`}
    <h4>Wording</h4>${optionsHtml('wording', wording, state.wording.value)}
    <label class="catalog-config-text" ${state.wording.requires_text ? '' : 'hidden'}>Nama / wording<textarea data-config-text rows="3" placeholder="${esc(state.wording.placeholder || 'Masukkan wording')}">${esc(state.customText)}</textarea><small>Wording ini akan dipaparkan semula dalam cart dan checkout.</small></label>
    <div class="catalog-config-qty"><span>Quantity</span><div><button type="button" data-config-minus>−</button><b data-config-qty>${state.qty}</b><button type="button" data-config-plus>+</button></div></div>
    <p class="catalog-config-error" data-config-error hidden></p>
    <div class="catalog-config-actions"><button type="button" data-config-add>${compact ? 'Simpan perubahan' : 'Add to Cart'}</button>${compact ? '<button type="button" data-config-cancel>Batal</button>' : '<button type="button" class="primary" data-config-buy>Buy Now</button>'}</div>
  </section>`;
}
function bindEditor(container: HTMLElement, product: CatalogProduct, state: EditorState, onSave: (item: CartItem) => void, onBuy?: (item: CartItem) => void) {
  const profile = product.product_order_profiles!;
  const sizes = profile.config.size_options || [];
  const wording = profile.config.wording_options || [];
  const paint = () => {
    container.querySelector<HTMLElement>('[data-config-price]')!.textContent = money(Number(state.size.price || product.base_price || 0));
    container.querySelector<HTMLElement>('[data-config-qty]')!.textContent = String(state.qty);
    const textWrap = container.querySelector<HTMLElement>('.catalog-config-text')!;
    textWrap.hidden = !state.wording.requires_text;
    const textArea = container.querySelector<HTMLTextAreaElement>('[data-config-text]')!;
    textArea.placeholder = state.wording.placeholder || 'Masukkan wording';
    container.querySelectorAll<HTMLButtonElement>('[data-config-group]').forEach((button) => {
      const current = button.dataset.configGroup === 'size' ? state.size.value : state.wording.value;
      button.classList.toggle('active', button.dataset.configValue === current);
    });
  };
  container.querySelectorAll<HTMLButtonElement>('[data-config-group]').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.configGroup === 'size') state.size = sizes.find((item) => item.value === button.dataset.configValue) || state.size;
      if (button.dataset.configGroup === 'wording') {
        state.wording = wording.find((item) => item.value === button.dataset.configValue) || state.wording;
        if (!state.wording.requires_text) state.customText = state.wording.default_text || '';
      }
      paint();
    };
  });
  container.querySelector<HTMLTextAreaElement>('[data-config-text]')!.oninput = (event) => { state.customText = (event.target as HTMLTextAreaElement).value; };
  container.querySelector<HTMLButtonElement>('[data-config-minus]')!.onclick = () => { state.qty = Math.max(1, state.qty - 1); paint(); };
  container.querySelector<HTMLButtonElement>('[data-config-plus]')!.onclick = () => { state.qty += 1; paint(); };
  const commit = (handler: (item: CartItem) => void) => {
    const error = validate(state);
    const errorNode = container.querySelector<HTMLElement>('[data-config-error]')!;
    if (error) {
      errorNode.hidden = false;
      errorNode.textContent = error;
      container.querySelector<HTMLTextAreaElement>('[data-config-text]')?.focus();
      return;
    }
    errorNode.hidden = true;
    handler(buildItem(product, state));
  };
  container.querySelector<HTMLButtonElement>('[data-config-add]')!.onclick = () => commit(onSave);
  container.querySelector<HTMLButtonElement>('[data-config-buy]')?.addEventListener('click', () => commit(onBuy || onSave));
  paint();
}
function addCartItem(item: CartItem, buyNow: boolean) {
  const cart = readCart();
  const existing = cart.find((entry) => entry.id === item.id);
  if (existing) existing.qty += item.qty;
  else cart.push(item);
  saveCart(cart);
  sessionStorage.setItem('catalog_cart_notice', `${item.title} ditambah ke cart`);
  location.assign(homeUrl(buyNow));
}
async function enhanceProductDetail() {
  const slug = currentSlug();
  if (!slug || isBasicSlug(slug) || enhancingSlug === slug) return;
  const article = document.querySelector<HTMLElement>('.catalog-product-detail');
  if (!article || document.querySelector(`[data-catalog-editor="${CSS.escape(slug)}"]`)) return;
  enhancingSlug = slug;
  try {
    const product = await getProduct(slug);
    if (!product.product_order_profiles) {
      const note = document.createElement('section');
      note.className = 'catalog-config-unavailable';
      note.textContent = 'Produk ini sedang disediakan untuk tempahan online. Gunakan WhatsApp buat sementara waktu.';
      article.insertAdjacentElement('afterend', note);
      return;
    }
    const state = defaults(product);
    const wrap = document.createElement('div');
    wrap.innerHTML = editorMarkup(product, state);
    const editor = wrap.firstElementChild as HTMLElement;
    article.insertAdjacentElement('afterend', editor);
    bindEditor(editor, product, state, (item) => addCartItem(item, false), (item) => addCartItem(item, true));
  } catch (error) { console.error('Catalogue configurator failed', error); }
  finally { enhancingSlug = ''; }
}
async function editCartItem(index: number) {
  const cart = readCart();
  const existing = cart[index];
  if (!existing?.catalog_slug) return;
  const product = await getProduct(existing.catalog_slug);
  const state = defaults(product, existing);
  const overlay = document.createElement('div');
  overlay.className = 'catalog-config-overlay';
  overlay.innerHTML = `<div class="catalog-config-dialog">${editorMarkup(product, state, true)}</div>`;
  document.body.append(overlay);
  const editor = overlay.querySelector<HTMLElement>('[data-catalog-editor]')!;
  bindEditor(editor, product, state, (item) => {
    cart[index] = item;
    saveCart(cart);
    overlay.remove();
    location.assign(homeUrl(true));
  });
  overlay.querySelector<HTMLButtonElement>('[data-config-cancel]')!.onclick = () => overlay.remove();
}
function enhanceCheckout() {
  const items = readCart();
  document.querySelectorAll<HTMLElement>('.checkout-item').forEach((node, index) => {
    const item = items[index];
    if (!item?.catalog_slug || node.dataset.catalogEnhanced) return;
    node.dataset.catalogEnhanced = '1';
    const image = node.querySelector<HTMLImageElement>('.checkout-thumb');
    const snapshotImage = String(item.product_snapshot?.image_url || '');
    if (image && snapshotImage) image.src = snapshotImage;
    const copy = node.querySelector<HTMLElement>('.checkout-item > div');
    if (!copy) return;
    const meta = document.createElement('small');
    meta.className = 'catalog-cart-meta';
    meta.textContent = `${item.style}${item.customText ? `: ${item.customText}` : ''}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'catalog-cart-edit';
    edit.textContent = 'Edit pilihan';
    edit.onclick = () => void editCartItem(index);
    copy.append(meta, edit);
  });
}
function openCheckoutWhenRequested() {
  const url = new URL(location.href);
  if (url.searchParams.get('checkout') !== '1') return;
  const tryOpen = () => {
    const button = document.querySelector<HTMLButtonElement>('#headCart');
    if (!button) return false;
    url.searchParams.delete('checkout');
    history.replaceState(history.state, '', url);
    button.click();
    return true;
  };
  if (!tryOpen()) {
    const timer = window.setInterval(() => { if (tryOpen()) window.clearInterval(timer); }, 80);
    window.setTimeout(() => window.clearInterval(timer), 5000);
  }
}
function showCartNotice() {
  const message = sessionStorage.getItem('catalog_cart_notice');
  if (!message) return;
  sessionStorage.removeItem('catalog_cart_notice');
  window.setTimeout(() => toast(message), 250);
}

const observer = new MutationObserver(() => {
  void enhanceProductDetail();
  enhanceCheckout();
});
observer.observe(root, { childList: true, subtree: true });
window.addEventListener('hashchange', () => void enhanceProductDetail());
window.addEventListener('popstate', () => void enhanceProductDetail());
window.setTimeout(() => {
  void enhanceProductDetail();
  enhanceCheckout();
  openCheckoutWhenRequested();
  showCartNotice();
});
