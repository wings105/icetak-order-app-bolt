import { supabase } from './supabase-client';

type SizeOption = { value: string; label?: string; price: number; stock?: number; image?: string };
type WordingOption = {
  value: string;
  label: string;
  requires_text?: boolean;
  default_text?: string;
  placeholder?: string;
  review_required?: boolean;
};
type ProfileConfig = {
  catalog_models?: boolean;
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
  metadata: {website_order?:{process?:string;review_required?:boolean;allow_custom?:boolean}};
  base_price: number | string | null;
  product_images: Array<{public_url:string;source_url:string;position:number}>;
  product_variants: Array<{id:string;name:string;price:number;stock:number;active:boolean;metadata:Record<string,unknown>}>;
  product_order_profiles: {
    code: string;
    product_type: 'printed' | 'edible' | 'burnaway' | 'wafer' | 'mirror' | 'acrylic';
    config: ProfileConfig;
  } | null;
};
type CartItem = {
  id: string;
  k: 'printed' | 'edible' | 'burnaway' | 'wafer' | 'mirror' | 'acrylic';
  title: string;
  process: string;
  review: 'Need Review' | 'No Review';
  size: string;
  sizeCode?: string;
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
  return hash.match(/^product\/(.+)$/)?.[1] || decodeURIComponent(location.pathname).match(/^\/product\/(.+)$/)?.[1] || new URL(location.href).searchParams.get('product') || '';
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
    .select('id,slug,display_name,source_title,description,parent_sku,clickup_task_id,main_image_url,metadata,base_price,product_images(public_url,source_url,position),product_variants(id,name,price,stock,active,metadata),product_order_profiles(code,product_type,config)')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Product not found');
  const row = data as unknown as CatalogProduct;
  if (row.product_order_profiles?.config.catalog_models) row.product_order_profiles.config.size_options = row.product_variants.filter(v=>v.active&&Number(v.price)>0&&Number(v.stock)>0).map(v=>({value:'model:'+v.id,label:v.name,price:Number(v.price),stock:v.stock,image:String(v.metadata.image_url||row.main_image_url||'')}));
  if (row.product_order_profiles?.product_type === 'printed') {
    row.product_order_profiles.config.wording_options = row.product_order_profiles.config.wording_options?.map(option =>
      option.value === 'custom_name' || option.value === 'model_custom'
        ? { ...option, label: 'Custom Words', placeholder: 'Tulis wording di sini. Contoh: Happy Birthday Aiman 6' } : option);
  }
  if(row.product_order_profiles?.config.catalog_models){const c=row.product_order_profiles.config;c.default_process=row.metadata?.website_order?.process||'Pre-order';if(row.metadata?.website_order?.allow_custom===false)c.wording_options=c.wording_options?.filter(w=>w.value!=='model_custom');if(row.metadata?.website_order?.review_required)c.wording_options=c.wording_options?.map(w=>({...w,review_required:true}));}
  productCache.set(slug, row);
  return row;
}
function defaults(product: CatalogProduct, existing?: CartItem): EditorState {
  const profile = product.product_order_profiles;
  if (!profile) throw new Error('Order profile not configured');
  const sizes = profile.config.size_options || [{ value: '1 pc', label: '1 pc', price: Number(product.base_price || 0) }];
  if (!sizes.length) throw new Error('Semua variasi kehabisan stok.');
  const wording = profile.config.wording_options || [{ value: 'no_wording', label: 'No Wording', requires_text: false, review_required: false }];
  return {
    size: sizes.find((item) => item.value === (existing?.sizeCode || existing?.size)) || sizes[0],
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
    size: profile.config.catalog_models ? (state.size.label || state.size.value) : state.size.value,
    sizeCode: state.size.value,
    style: state.wording.label,
    customText: text,
    price: Number(state.size.price || product.base_price || 0),
    qty: state.qty,
    product_id: product.id,
    product_variant_id: profile.config.catalog_models ? state.size.value.slice(6) : null,
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
      admin_process: profile.config.default_process || 'Pre-order',
    },
    product_snapshot: {
      product_name: product.display_name,
      source_title: product.source_title || product.display_name,
      parent_sku: product.parent_sku || '',
      image_url: state.size.image || product.main_image_url || '',
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
    ${profile.config.catalog_models ? `<h4>Variasi</h4><select data-config-model aria-label="Variasi produk">${sizes.map(s=>`<option value="${esc(s.value)}" ${s.value===state.size.value?'selected':''}>${esc(s.label||s.value)} · ${money(s.price)}</option>`).join('')}</select><img data-config-model-image src="${esc(state.size.image||product.main_image_url||'')}" alt="" style="max-width:140px;max-height:140px;object-fit:contain;margin-top:12px"/>` : sizes.length > 1 ? `<h4>Saiz</h4>${optionsHtml('size', sizes, state.size.value)}` : `<div class="catalog-config-single"><span>Saiz</span><b>${esc(state.size.label || state.size.value)}</b></div>`}
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
  let customDraft = state.wording.requires_text ? state.customText : '';
  const paint = () => {
    container.querySelector<HTMLElement>('[data-config-price]')!.textContent = money(Number(state.size.price || product.base_price || 0));
    container.querySelector<HTMLElement>('[data-config-qty]')!.textContent = String(state.qty);
    const textWrap = container.querySelector<HTMLElement>('.catalog-config-text')!;
    textWrap.hidden = !state.wording.requires_text;
    const textArea = container.querySelector<HTMLTextAreaElement>('[data-config-text]')!;
    textArea.placeholder = state.wording.placeholder || 'Masukkan wording';
    textArea.value = state.wording.requires_text ? state.customText : '';
    textArea.required = Boolean(state.wording.requires_text);
    container.querySelectorAll<HTMLButtonElement>('[data-config-group]').forEach((button) => {
      const current = button.dataset.configGroup === 'size' ? state.size.value : state.wording.value;
      button.classList.toggle('active', button.dataset.configValue === current);
    });
  };
  container.querySelector<HTMLSelectElement>('[data-config-model]')?.addEventListener('change',e=>{state.size=sizes.find(s=>s.value===(e.target as HTMLSelectElement).value)||state.size;state.qty=Math.min(state.qty,state.size.stock||1);const img=container.querySelector<HTMLImageElement>('[data-config-model-image]');if(img)img.src=state.size.image||product.main_image_url||'';paint();});
  container.querySelectorAll<HTMLButtonElement>('[data-config-group]').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.configGroup === 'size') state.size = sizes.find((item) => item.value === button.dataset.configValue) || state.size;
      if (button.dataset.configGroup === 'wording') {
        if (state.wording.requires_text) customDraft = state.customText;
        state.wording = wording.find((item) => item.value === button.dataset.configValue) || state.wording;
        state.customText = state.wording.requires_text ? customDraft : (state.wording.default_text || '');
        container.querySelector<HTMLElement>('[data-config-error]')!.hidden = true;
      }
      paint();
    };
  });
  container.querySelector<HTMLTextAreaElement>('[data-config-text]')!.oninput = (event) => { state.customText = (event.target as HTMLTextAreaElement).value; };
  container.querySelector<HTMLButtonElement>('[data-config-minus]')!.onclick = () => { state.qty = Math.max(1, state.qty - 1); paint(); };
  container.querySelector<HTMLButtonElement>('[data-config-plus]')!.onclick = () => { state.qty = Math.min(state.qty + 1, state.size.stock ?? 999); paint(); };
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
function utilityIcon(kind: 'chat' | 'shop' | 'share') {
  const paths = {
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    shop: '<path d="M6 7h12l2 14H4L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2M10 11c0-1 4-1 4 .5s-4 1-4 3 4 2 4 .5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  };
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
let closeProductSheet: (() => void) | undefined;
function productOptions(product: CatalogProduct, state: EditorState, opener: HTMLElement) {
  closeProductSheet?.();
  const overlay = document.createElement('div');
  overlay.className = 'catalog-config-overlay catalog-glossy-overlay';
  overlay.innerHTML = `<div class="catalog-config-dialog" role="dialog" aria-modal="true" aria-label="Pilihan tempahan ${esc(product.display_name)}"><button type="button" class="catalog-config-close" aria-label="Tutup pilihan">×</button>${editorMarkup(product, state)}</div>`;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    document.removeEventListener('keydown', keyboard);
    closeProductSheet = undefined;
    if (opener.isConnected) opener.focus();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(overlay.querySelectorAll<HTMLElement>('button,select,textarea')).filter(node => !node.closest('[hidden]') && !(node as HTMLButtonElement).disabled);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  closeProductSheet = close;
  document.body.append(overlay);
  const editor = overlay.querySelector<HTMLElement>('[data-catalog-editor]')!;
  bindEditor(editor, product, state, item => addCartItem(item, false), item => addCartItem(item, true));
  overlay.querySelector<HTMLButtonElement>('.catalog-config-close')!.onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  document.addEventListener('keydown', keyboard);
  overlay.querySelector<HTMLButtonElement>('.catalog-config-close')!.focus();
}
async function enhanceProductDetail() {
  const slug = currentSlug();
  if (!slug || isBasicSlug(slug) || enhancingSlug === slug) return;
  const article = document.querySelector<HTMLElement>('.catalog-product-detail');
  if (!article || article.dataset.catalogReady || document.querySelector(`[data-catalog-editor="${CSS.escape(slug)}"]`)) return;
  enhancingSlug = slug;
  try {
    const product = await getProduct(slug);
    if (!article.isConnected || currentSlug() !== slug) return;
    article.dataset.catalogReady = '1';
    if (!product.product_order_profiles) {
      const note = document.createElement('section');
      note.className = 'catalog-config-unavailable';
      note.textContent = 'Produk ini sedang disediakan untuk tempahan online. Gunakan WhatsApp buat sementara waktu.';
      article.insertAdjacentElement('afterend', note);
      return;
    }
    const glossy = product.product_order_profiles.product_type === 'printed';
    const images = (product.product_images || []).slice().sort((a,b) => a.position-b.position);
    if (images.length > 1) {
      const gallery = document.createElement('div');
      gallery.className = 'catalog-product-gallery';
      gallery.innerHTML = images.map((im,i) => `<button type="button" aria-label="Gambar produk ${i+1}" aria-pressed="${i===0}"><img src="${esc(im.public_url||im.source_url)}" alt="" loading="lazy"/></button>`).join('');
      gallery.querySelectorAll('button').forEach((button,i) => button.onclick = () => {
        article.querySelector<HTMLImageElement>(':scope > img')!.src = images[i].public_url || images[i].source_url;
        gallery.querySelectorAll('button').forEach((node,j) => node.setAttribute('aria-pressed',String(i===j)));
      });
      article.append(gallery);
    }
    const state = defaults(product);
    if (glossy) {
      article.classList.add('catalog-glossy-detail');
      article.closest('main')?.classList.add('catalog-glossy-main');
      const actions = article.querySelector<HTMLElement>('.catalog-detail-actions');
      if (actions) {
        actions.className = 'catalog-utility-actions';
        actions.setAttribute('aria-label','Pautan produk');
        actions.querySelectorAll<HTMLElement>('a,button').forEach(node => {
          const kind = node.tagName === 'BUTTON' ? 'share' : (node.getAttribute('href')?.includes('wa.me') ? 'chat' : 'shop');
          const label = kind === 'share' ? 'Kongsi produk' : kind === 'shop' ? 'Buka di Shopee' : 'Tanya seller melalui WhatsApp';
          node.setAttribute('aria-label', label);
          node.setAttribute('title', label);
          node.innerHTML = utilityIcon(kind);
        });
        article.prepend(actions);
      }
      const price = document.createElement('strong');
      price.className = 'catalog-glossy-price';
      price.textContent = money(Number(state.size.price || product.base_price || 0));
      article.querySelector('.catalog-detail-copy h2')?.insertAdjacentElement('beforebegin',price);
      const bar = document.createElement('section');
      bar.className = 'catalog-glossy-buybar';
      bar.dataset.catalogEditor = slug;
      bar.setAttribute('aria-label','Beli cake topper');
      bar.innerHTML = `<div><small>Harga dari</small><strong>${esc(price.textContent)}</strong></div><button type="button" data-glossy-add>Add to Cart</button><button type="button" class="primary" data-glossy-buy>Buy Now</button>`;
      article.insertAdjacentElement('afterend',bar);
      bar.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => productOptions(product,state,button));
    } else {
      const wrap = document.createElement('div');
      wrap.innerHTML = editorMarkup(product,state);
      const editor = wrap.firstElementChild as HTMLElement;
      article.insertAdjacentElement('afterend',editor);
      bindEditor(editor,product,state,item => addCartItem(item,false),item => addCartItem(item,true));
    }
  } catch (error) {
    if (!article.isConnected) return;
    article.dataset.catalogReady = '1';
    const note = document.createElement('p');
    note.className = 'catalog-config-unavailable';
    note.dataset.catalogEditor = slug;
    note.textContent = error instanceof Error ? error.message : 'Produk tidak tersedia';
    article.insertAdjacentElement('afterend',note);
  } finally { enhancingSlug = ''; }
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
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'catalog-cart-edit';
    edit.textContent = 'Edit pilihan';
    edit.onclick = () => void editCartItem(index);
    // The checkout item already renders size, wording choice and custom text.
    copy.append(edit);
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
  if (closeProductSheet && !document.querySelector('.catalog-glossy-buybar')) closeProductSheet();
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
