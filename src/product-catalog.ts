import './product-catalog.css';
import { supabase } from './supabase-client';

type BasicKey = 'edible' | 'burnaway' | 'wafer' | 'printed' | 'mirror' | 'acrylic';
type CatalogProduct = {
  slug: string;
  displayTitle: string;
  title: string;
  description: string;
  category: string;
  parentSku: string;
  shopeeProductId: string;
  imageUrl: string;
  shopeeUrl: string;
  clickupTaskId: string;
  source: string;
};
type SearchRow = {
  slug: string;
  display_title: string;
  title: string;
  description: string | null;
  category: string | null;
  parent_sku: string | null;
  shopee_product_id: string | null;
  image_url: string | null;
  shopee_url: string | null;
  clickup_task_id: string | null;
  source: string;
  total_count: number | string;
};
type ProfileOption = {
  code: string;
  label: string;
  fixed_text?: string;
  placeholder?: string;
  requires_text?: boolean;
  review_required?: boolean;
};
type SizeOption = {
  code: string;
  label: string;
  size?: string;
  price: number | string;
};
type ProductConfig = {
  product: {
    id: string;
    slug: string;
    name: string;
    source_title: string;
    description: string;
    image_url: string;
    parent_sku: string;
    clickup_task_id: string;
    product_type: string;
    is_orderable: boolean;
  };
  profile: {
    id: string;
    code: string;
    name: string;
    product_type: string;
    configuration: {
      default_price?: number | string;
      requires_size?: boolean;
      default_wording_mode?: string;
      wording_options?: ProfileOption[];
      sizes?: SizeOption[];
    };
  };
  variants: unknown[];
};
type CatalogCartLine = {
  id: string;
  catalogSlug: string;
  productId: string;
  title: string;
  imageUrl: string;
  parentSku: string;
  catalogClickupTaskId: string;
  productType: string;
  profileCode: string;
  wordingMode: string;
  wordingLabel: string;
  customText: string;
  sizeCode: string;
  sizeLabel: string;
  unitPrice: number;
  qty: number;
  reviewRequired: boolean;
};

const BASIC: Record<BasicKey, string> = {
  edible: 'edible-image',
  burnaway: 'burn-away-combo',
  wafer: 'wafer-paper',
  printed: 'cake-topper',
  mirror: 'mirror-gold-artpaper',
  acrylic: 'acrylic-cake-topper',
};
const BASIC_BY_SLUG = Object.fromEntries(Object.entries(BASIC).map(([key, slug]) => [slug, key])) as Record<string, BasicKey>;
const BASIC_LABEL: Record<BasicKey, string> = {
  edible: 'Edible Image',
  burnaway: 'Burn Away Combo',
  wafer: 'Wafer Paper Only',
  printed: 'Cake Topper',
  mirror: 'Mirror Gold Artpaper',
  acrylic: 'Acrylic Cake Topper',
};
const CART_KEY = 'icetak_catalog_cart_v1';
const root = document.querySelector<HTMLDivElement>('#app')!;
let routeRendering = false;
let basicOpened = '';

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}
function money(value: number) {
  return `RM${Number(value || 0).toFixed(2)}`;
}
function uid() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `line_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
function ensureStyles() {
  if (document.querySelector('#catalogConfiguratorStyles')) return;
  const style = document.createElement('style');
  style.id = 'catalogConfiguratorStyles';
  style.textContent = `
    .catalog-cart-head{position:relative}.catalog-cart-head .catalog-cart-count{position:absolute;right:4px;top:2px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#ee4d2d;color:#fff;font:700 11px/18px sans-serif;text-align:center}
    .catalog-configurator{margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0}.catalog-configurator fieldset{border:0;padding:0;margin:0 0 18px}.catalog-configurator legend{font-weight:800;margin-bottom:9px}.catalog-choice-grid{display:flex;flex-wrap:wrap;gap:8px}.catalog-choice{position:relative}.catalog-choice input{position:absolute;opacity:0;pointer-events:none}.catalog-choice span{display:block;padding:10px 12px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;font-weight:700;font-size:13px}.catalog-choice input:checked+span{border-color:#ee4d2d;background:#fff3ef;color:#c24124;box-shadow:0 0 0 1px #ee4d2d}.catalog-custom-text{display:grid;gap:7px;margin:-7px 0 16px}.catalog-custom-text textarea{min-height:84px;resize:vertical;border:1px solid #cbd5e1;border-radius:12px;padding:11px;font:inherit}.catalog-qty-row{display:flex;align-items:center;gap:8px}.catalog-qty-row button{width:38px;height:38px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:20px}.catalog-qty-row input{width:60px;height:38px;border:1px solid #cbd5e1;border-radius:10px;text-align:center;font:inherit}.catalog-buy-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.catalog-buy-row button{border:1px solid #ee4d2d;border-radius:12px;background:#fff;color:#ee4d2d;padding:13px;font-weight:900}.catalog-buy-row .primary{background:#ee4d2d;color:#fff}.catalog-live-price{font-size:25px;font-weight:900;color:#ee4d2d;margin:10px 0}.catalog-form-error{display:none;margin:10px 0;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-weight:700;font-size:13px}.catalog-form-error.show{display:block}
    .catalog-floating-cart{position:fixed;z-index:80;right:16px;bottom:78px;border:0;border-radius:999px;background:#0f172a;color:#fff;padding:12px 16px;box-shadow:0 12px 30px rgba(15,23,42,.25);font-weight:900}.catalog-floating-cart b{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:6px;padding:0 5px;border-radius:999px;background:#ee4d2d}
    .catalog-cart-list{display:grid;gap:12px}.catalog-cart-line{display:grid;grid-template-columns:82px 1fr;gap:12px;padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:16px}.catalog-cart-line img{width:82px;height:82px;object-fit:cover;border-radius:12px;background:#f8fafc}.catalog-cart-copy h2{font-size:15px;margin:0 0 6px}.catalog-cart-copy p{margin:2px 0;color:#475569;font-size:12px}.catalog-cart-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:10px}.catalog-cart-actions button{border:1px solid #cbd5e1;border-radius:9px;background:#fff;padding:7px 10px;font-weight:700}.catalog-cart-actions .danger{color:#b91c1c}.catalog-cart-total{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 -8px 22px rgba(15,23,42,.08)}.catalog-cart-total strong{font-size:20px}.catalog-cart-total button{border:0;border-radius:11px;background:#ee4d2d;color:#fff;padding:12px 18px;font-weight:900}
    .catalog-checkout-layout{display:grid;gap:14px}.catalog-checkout-card{padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:17px}.catalog-checkout-card h2{margin:0 0 13px;font-size:17px}.catalog-checkout-form{display:grid;gap:11px}.catalog-checkout-form label{display:grid;gap:6px;font-weight:700;font-size:13px}.catalog-checkout-form input,.catalog-checkout-form select,.catalog-checkout-form textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:11px;padding:11px;font:inherit}.catalog-checkout-form button[type=submit]{border:0;border-radius:12px;background:#ee4d2d;color:#fff;padding:14px;font-weight:900;font-size:16px}.catalog-checkout-item{padding:10px 0;border-bottom:1px solid #e2e8f0}.catalog-checkout-item:last-child{border-bottom:0}.catalog-checkout-item b{display:block}.catalog-checkout-item small{display:block;color:#64748b;margin-top:3px}.catalog-checkout-total{display:flex;justify-content:space-between;margin-top:12px;font-size:19px;font-weight:900}.catalog-submit-state{display:none;text-align:center;color:#475569;font-weight:700}.catalog-submit-state.show{display:block}
    @media(min-width:800px){.catalog-checkout-layout{grid-template-columns:minmax(0,1fr) minmax(340px,.72fr)}.catalog-checkout-summary{order:2}.catalog-checkout-customer{order:1}}
  `;
  document.head.append(style);
}
function rowToProduct(row: SearchRow): CatalogProduct {
  return {
    slug: row.slug,
    displayTitle: row.display_title,
    title: row.title,
    description: row.description || '',
    category: row.category || 'Produk',
    parentSku: row.parent_sku || '',
    shopeeProductId: row.shopee_product_id || '',
    imageUrl: row.image_url || './icon.svg',
    shopeeUrl: row.shopee_url || '',
    clickupTaskId: row.clickup_task_id || '',
    source: row.source || 'supabase',
  };
}
function readCart(): CatalogCartLine[] {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeCart(lines: CatalogCartLine[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(lines));
  updateCartIndicators();
}
function cartCount() {
  return readCart().reduce((sum, line) => sum + Math.max(1, Number(line.qty || 1)), 0);
}
function cartTotal(lines = readCart()) {
  return lines.reduce((sum, line) => sum + Number(line.unitPrice || 0) * Math.max(1, Number(line.qty || 1)), 0);
}
function queryRoute() {
  const url = new URL(location.href);
  if (url.searchParams.has('order') || url.searchParams.has('confirm') || url.searchParams.has('login')) return { kind: 'none' as const, value: '' };
  const q = url.searchParams.get('q')?.trim();
  if (q) return { kind: 'search' as const, value: q };
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (hash === 'catalog-cart') return { kind: 'cart' as const, value: '' };
  if (hash === 'catalog-checkout') return { kind: 'checkout' as const, value: '' };
  const path = decodeURIComponent(location.pathname.replace(/^\//, ''));
  const product = (hash.match(/^product\/(.+)$/) || path.match(/^product\/(.+)$/))?.[1] || url.searchParams.get('product') || '';
  if (product) return { kind: 'product' as const, value: product };
  const search = (hash.match(/^search\/(.+)$/) || path.match(/^search\/(.+)$/))?.[1] || '';
  return search ? { kind: 'search' as const, value: search } : { kind: 'none' as const, value: '' };
}
function setMeta(title: string, description: string) {
  document.title = title;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = description;
}
function baseUrl() {
  const url = new URL(location.href);
  ['q', 'product', 'editCart'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  return url;
}
function productUrl(slug: string) {
  const url = baseUrl();
  url.hash = `/product/${slug}`;
  return url.toString();
}
function searchUrl(q: string) {
  const url = baseUrl();
  url.searchParams.set('q', q);
  return url.toString();
}
function cartUrl() {
  const url = baseUrl();
  url.hash = '/catalog-cart';
  return url.toString();
}
function checkoutUrl() {
  const url = baseUrl();
  url.hash = '/catalog-checkout';
  return url.toString();
}
function home() {
  location.href = baseUrl().toString();
}
function shell(title: string, body: string) {
  return `<header class="catalog-route-head"><button id="catalogBack" aria-label="Kembali">‹</button><div><small>DecoCake.my</small><h1>${esc(title)}</h1></div><button id="catalogCartHead" class="catalog-cart-head" aria-label="Troli">🛒<span class="catalog-cart-count">${cartCount()}</span></button></header>${body}`;
}
function bindShell() {
  document.querySelector<HTMLButtonElement>('#catalogBack')?.addEventListener('click', () => (history.length > 1 ? history.back() : home()));
  document.querySelector<HTMLButtonElement>('#catalogCartHead')?.addEventListener('click', () => {
    history.pushState({ catalog: 'cart' }, '', cartUrl());
    void renderCart();
  });
}
function loading(title: string) {
  root.innerHTML = shell(title, '<main class="catalog-route-main"><div class="catalog-loading"><i></i><b>Sedang memuatkan…</b></div></main>');
  bindShell();
}
async function shareProduct(title: string, text: string, url: string, button?: HTMLButtonElement) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('Native product share failed, using link fallback', error);
    }
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(url);
    if (button) {
      const original = button.textContent || 'Kongsi produk';
      button.textContent = 'Link disalin ✓';
      window.setTimeout(() => { button.textContent = original; }, 1800);
    }
  } catch {
    window.prompt('Salin link produk:', url);
  }
}
function card(product: CatalogProduct) {
  return `<article class="catalog-result-card"><button data-catalog-product="${esc(product.slug)}"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}" loading="lazy"><span class="catalog-source">${esc(product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${product.parentSku ? `SKU ${esc(product.parentSku)}` : esc(product.title.slice(0, 100))}</p><b>Pilih & tempah ›</b></button></article>`;
}
async function searchProducts(q: string) {
  const { data, error } = await (supabase as any).rpc('search_product_catalog', { p_query: q, p_limit: 36, p_offset: 0 });
  if (error) throw error;
  const rows = (data || []) as SearchRow[];
  return { items: rows.map(rowToProduct), total: Number(rows[0]?.total_count || 0) };
}
async function getProduct(slug: string) {
  const { data, error } = await (supabase as any)
    .from('products')
    .select('slug,display_name,name,source_title,description,parent_sku,shopee_product_id,main_image_url,shopee_url,clickup_task_id,source,product_categories(name)')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Product not found');
  const categoryValue = data.product_categories;
  const category = Array.isArray(categoryValue) ? categoryValue[0]?.name : categoryValue?.name;
  return rowToProduct({
    slug: data.slug,
    display_title: data.display_name,
    title: data.source_title || data.name,
    description: data.description,
    category: category || 'Produk',
    parent_sku: data.parent_sku,
    shopee_product_id: data.shopee_product_id,
    image_url: data.main_image_url,
    shopee_url: data.shopee_url,
    clickup_task_id: data.clickup_task_id,
    source: data.source,
    total_count: 1,
  });
}
async function getProductConfig(slug: string): Promise<ProductConfig> {
  const { data, error } = await (supabase as any).rpc('icetak_catalog_product_config', { p_slug: slug });
  if (error) throw error;
  if (!data?.product?.is_orderable) throw new Error('Produk ini belum tersedia untuk tempahan terus.');
  return data as ProductConfig;
}
function navigateProduct(slug: string) {
  history.pushState({ catalog: 'product' }, '', productUrl(slug));
  if (BASIC_BY_SLUG[slug]) applyRoute();
  else void renderCatalogProduct(slug);
}
async function renderSearch(q: string) {
  routeRendering = true;
  loading(`Carian: ${q}`);
  try {
    const data = await searchProducts(q);
    setMeta(`${q} Cake Topper & Edible Image | DecoCake.my`, `Lihat semua produk ${q} yang tersedia di DecoCake.my.`);
    const results = data.items.length
      ? `<section class="catalog-results">${data.items.map(card).join('')}</section>`
      : `<section class="catalog-empty"><b>Tiada produk “${esc(q)}” dijumpai</b><p>Cuba ejaan lain atau pilih servis custom di bawah.</p><div class="basic-suggestions">${(Object.keys(BASIC) as BasicKey[]).map((key) => `<a href="${esc(productUrl(BASIC[key]))}">${BASIC_LABEL[key]}</a>`).join('')}</div></section>`;
    root.innerHTML = shell(`Hasil carian “${q}”`, `<main class="catalog-route-main"><form id="catalogRouteSearch" class="catalog-route-search"><input name="q" value="${esc(q)}" aria-label="Cari produk" required><button>Cari</button></form><div class="catalog-result-count"><b>${data.total}</b> produk dijumpai</div>${results}</main>`);
    bindShell();
    document.querySelector<HTMLFormElement>('#catalogRouteSearch')!.onsubmit = (event) => {
      event.preventDefault();
      const next = String(new FormData(event.currentTarget).get('q') || '').trim();
      if (next) {
        history.pushState({ catalog: 'search' }, '', searchUrl(next));
        void renderSearch(next);
      }
    };
    document.querySelectorAll<HTMLButtonElement>('[data-catalog-product]').forEach((button) => {
      button.onclick = () => navigateProduct(button.dataset.catalogProduct!);
    });
  } catch (error) {
    console.error('Supabase catalogue search failed', error);
    root.innerHTML = shell(`Carian: ${q}`, '<main class="catalog-route-main"><section class="catalog-empty"><b>Carian tidak dapat dimuatkan</b><p>Tekan cuba lagi atau terus pilih servis custom.</p><button id="catalogRetry">Cuba lagi</button></section></main>');
    bindShell();
    document.querySelector<HTMLButtonElement>('#catalogRetry')!.onclick = () => void renderSearch(q);
  } finally {
    routeRendering = false;
  }
}
function selectedOption<T extends { code: string }>(options: T[], code: string) {
  return options.find((item) => item.code === code);
}
async function renderCatalogProduct(slug: string) {
  routeRendering = true;
  loading('Produk');
  try {
    const [product, config] = await Promise.all([getProduct(slug), getProductConfig(slug)]);
    setMeta(`${product.displayTitle} | DecoCake.my`, product.description || product.title);
    const profile = config.profile.configuration || {};
    const wordingOptions = Array.isArray(profile.wording_options) ? profile.wording_options : [];
    const sizeOptions = Array.isArray(profile.sizes) ? profile.sizes : [];
    const editId = new URL(location.href).searchParams.get('editCart') || '';
    const existing = readCart().find((line) => line.id === editId && line.catalogSlug === slug);
    const defaultMode = existing?.wordingMode || profile.default_wording_mode || wordingOptions[0]?.code || '';
    const defaultSize = existing?.sizeCode || sizeOptions[0]?.code || '';
    const defaultQty = existing?.qty || 1;
    const url = productUrl(product.slug);
    const wa = `https://wa.me/60179860656?text=${encodeURIComponent(`Hi iCetak, saya berminat dengan produk ini:\n${product.displayTitle}\n${url}`)}`;
    const wordingHtml = wordingOptions.map((option) => `<label class="catalog-choice"><input type="radio" name="wordingMode" value="${esc(option.code)}" ${option.code === defaultMode ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('');
    const sizeHtml = sizeOptions.map((option) => `<label class="catalog-choice"><input type="radio" name="sizeCode" value="${esc(option.code)}" ${option.code === defaultSize ? 'checked' : ''}><span>${esc(option.label)} · ${money(Number(option.price))}</span></label>`).join('');
    root.innerHTML = shell(product.displayTitle, `<main class="catalog-route-main"><article class="catalog-product-detail"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}"><div class="catalog-detail-copy"><span>${esc(product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${esc(product.description || product.title)}</p>${product.parentSku ? `<small>Parent SKU: ${esc(product.parentSku)}</small>` : ''}<form id="catalogConfigurator" class="catalog-configurator">${profile.requires_size ? `<fieldset><legend>Pilih saiz</legend><div class="catalog-choice-grid">${sizeHtml}</div></fieldset>` : ''}<fieldset><legend>Pilih wording</legend><div class="catalog-choice-grid">${wordingHtml}</div></fieldset><label id="catalogCustomTextWrap" class="catalog-custom-text"><b>Masukkan wording</b><textarea id="catalogCustomText" placeholder="" maxlength="180">${esc(existing?.customText || '')}</textarea></label><div class="catalog-qty-row"><b>Kuantiti</b><button type="button" id="catalogQtyMinus">−</button><input id="catalogQty" inputmode="numeric" value="${defaultQty}" aria-label="Kuantiti"><button type="button" id="catalogQtyPlus">+</button></div><div id="catalogLivePrice" class="catalog-live-price"></div><div id="catalogFormError" class="catalog-form-error"></div><div class="catalog-buy-row"><button type="submit">${existing ? 'Kemas kini cart' : 'Add to Cart'}</button><button type="button" id="catalogBuyNow" class="primary">Buy Now</button></div></form><div class="catalog-detail-actions"><a class="primary" href="${wa}" target="_blank" rel="noopener">Tanya melalui WhatsApp</a>${product.shopeeUrl ? `<a href="${esc(product.shopeeUrl)}" target="_blank" rel="noopener">Buka di Shopee</a>` : ''}<button id="shareCatalogProduct" type="button">Kongsi produk</button></div></div></article></main>`);
    bindShell();
    const form = document.querySelector<HTMLFormElement>('#catalogConfigurator')!;
    const customWrap = document.querySelector<HTMLElement>('#catalogCustomTextWrap')!;
    const customInput = document.querySelector<HTMLTextAreaElement>('#catalogCustomText')!;
    const qtyInput = document.querySelector<HTMLInputElement>('#catalogQty')!;
    const priceNode = document.querySelector<HTMLElement>('#catalogLivePrice')!;
    const errorNode = document.querySelector<HTMLElement>('#catalogFormError')!;
    const syncForm = () => {
      const mode = String(new FormData(form).get('wordingMode') || defaultMode);
      const wording = selectedOption(wordingOptions, mode);
      const sizeCode = String(new FormData(form).get('sizeCode') || defaultSize);
      const size = selectedOption(sizeOptions, sizeCode);
      const requiresText = Boolean(wording?.requires_text);
      customWrap.style.display = requiresText ? 'grid' : 'none';
      customInput.required = requiresText;
      customInput.placeholder = wording?.placeholder || 'Masukkan wording';
      const unitPrice = Number(size?.price ?? profile.default_price ?? 0);
      const qty = Math.max(1, Number.parseInt(qtyInput.value || '1', 10) || 1);
      qtyInput.value = String(qty);
      priceNode.textContent = `${money(unitPrice)} × ${qty} = ${money(unitPrice * qty)}`;
      return { mode, wording, sizeCode, size, unitPrice, qty, requiresText };
    };
    form.addEventListener('change', syncForm);
    qtyInput.addEventListener('input', syncForm);
    document.querySelector<HTMLButtonElement>('#catalogQtyMinus')!.onclick = () => { qtyInput.value = String(Math.max(1, Number(qtyInput.value || 1) - 1)); syncForm(); };
    document.querySelector<HTMLButtonElement>('#catalogQtyPlus')!.onclick = () => { qtyInput.value = String(Math.max(1, Number(qtyInput.value || 1) + 1)); syncForm(); };
    const saveLine = (goCheckout: boolean) => {
      const state = syncForm();
      errorNode.classList.remove('show');
      if (profile.requires_size && !state.size) {
        errorNode.textContent = 'Sila pilih saiz.';
        errorNode.classList.add('show');
        return;
      }
      const enteredText = customInput.value.trim();
      if (state.requiresText && !enteredText) {
        errorNode.textContent = 'Sila masukkan wording atau nama.';
        errorNode.classList.add('show');
        customInput.focus();
        return;
      }
      const fixedText = state.wording?.fixed_text || '';
      const line: CatalogCartLine = {
        id: existing?.id || uid(),
        catalogSlug: slug,
        productId: config.product.id,
        title: product.displayTitle,
        imageUrl: product.imageUrl,
        parentSku: product.parentSku,
        catalogClickupTaskId: product.clickupTaskId,
        productType: config.profile.product_type,
        profileCode: config.profile.code,
        wordingMode: state.mode,
        wordingLabel: state.wording?.label || state.mode,
        customText: state.requiresText ? enteredText : fixedText,
        sizeCode: state.sizeCode,
        sizeLabel: state.size?.label || '',
        unitPrice: state.unitPrice,
        qty: state.qty,
        reviewRequired: Boolean(state.wording?.review_required),
      };
      const lines = readCart();
      const index = lines.findIndex((item) => item.id === line.id);
      if (index >= 0) lines[index] = line;
      else lines.push(line);
      writeCart(lines);
      const clean = new URL(location.href);
      clean.searchParams.delete('editCart');
      history.replaceState(history.state, '', clean);
      if (goCheckout) {
        history.pushState({ catalog: 'checkout' }, '', checkoutUrl());
        void renderCheckout();
      } else {
        history.pushState({ catalog: 'cart' }, '', cartUrl());
        void renderCart();
      }
    };
    form.onsubmit = (event) => { event.preventDefault(); saveLine(false); };
    document.querySelector<HTMLButtonElement>('#catalogBuyNow')!.onclick = () => saveLine(true);
    const shareButton = document.querySelector<HTMLButtonElement>('#shareCatalogProduct')!;
    shareButton.onclick = () => void shareProduct(product.displayTitle, product.description || product.title, url, shareButton);
    syncForm();
  } catch (error) {
    console.error('Supabase catalogue product failed', error);
    root.innerHTML = shell('Produk tidak tersedia', `<main class="catalog-route-main"><section class="catalog-empty"><b>Produk ini belum boleh ditempah terus.</b><p>${esc(error instanceof Error ? error.message : 'Sila cuba lagi.')}</p><button id="catalogHomeFromError">Kembali ke katalog</button></section></main>`);
    bindShell();
    document.querySelector<HTMLButtonElement>('#catalogHomeFromError')!.onclick = home;
  } finally {
    routeRendering = false;
  }
}
function lineDetails(line: CatalogCartLine) {
  return [line.sizeLabel, line.wordingLabel, line.customText].filter(Boolean).map(esc).join(' · ');
}
async function renderCart() {
  routeRendering = true;
  const lines = readCart();
  setMeta('Cart | DecoCake.my', 'Semak produk dan wording sebelum checkout.');
  const body = lines.length
    ? `<section class="catalog-cart-list">${lines.map((line) => `<article class="catalog-cart-line" data-line-id="${esc(line.id)}"><img src="${esc(line.imageUrl || './icon.svg')}" alt="${esc(line.title)}"><div class="catalog-cart-copy"><h2>${esc(line.title)}</h2><p>${lineDetails(line)}</p><p>${money(line.unitPrice)} × ${line.qty} = <b>${money(line.unitPrice * line.qty)}</b></p><div class="catalog-cart-actions"><button data-cart-minus="${esc(line.id)}">−</button><b>${line.qty}</b><button data-cart-plus="${esc(line.id)}">+</button><button data-cart-edit="${esc(line.id)}">Edit</button><button class="danger" data-cart-remove="${esc(line.id)}">Buang</button></div></div></article>`).join('')}</section><div class="catalog-cart-total"><div><small>Jumlah</small><strong>${money(cartTotal(lines))}</strong></div><button id="catalogCheckout">Checkout (${cartCount()})</button></div>`
    : '<section class="catalog-empty"><b>Cart masih kosong</b><p>Cari design dan pilih wording dahulu.</p><button id="catalogContinueShopping">Cari produk</button></section>';
  root.innerHTML = shell('Cart', `<main class="catalog-route-main">${body}</main>`);
  bindShell();
  const mutate = (id: string, action: 'minus' | 'plus' | 'remove') => {
    const next = readCart();
    const index = next.findIndex((line) => line.id === id);
    if (index < 0) return;
    if (action === 'remove') next.splice(index, 1);
    else next[index].qty = Math.max(1, next[index].qty + (action === 'plus' ? 1 : -1));
    writeCart(next);
    void renderCart();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-cart-minus]').forEach((button) => { button.onclick = () => mutate(button.dataset.cartMinus!, 'minus'); });
  document.querySelectorAll<HTMLButtonElement>('[data-cart-plus]').forEach((button) => { button.onclick = () => mutate(button.dataset.cartPlus!, 'plus'); });
  document.querySelectorAll<HTMLButtonElement>('[data-cart-remove]').forEach((button) => { button.onclick = () => mutate(button.dataset.cartRemove!, 'remove'); });
  document.querySelectorAll<HTMLButtonElement>('[data-cart-edit]').forEach((button) => {
    button.onclick = () => {
      const line = readCart().find((item) => item.id === button.dataset.cartEdit);
      if (!line) return;
      const url = new URL(productUrl(line.catalogSlug));
      url.searchParams.set('editCart', line.id);
      history.pushState({ catalog: 'product' }, '', url);
      void renderCatalogProduct(line.catalogSlug);
    };
  });
  document.querySelector<HTMLButtonElement>('#catalogCheckout')?.addEventListener('click', () => {
    history.pushState({ catalog: 'checkout' }, '', checkoutUrl());
    void renderCheckout();
  });
  document.querySelector<HTMLButtonElement>('#catalogContinueShopping')?.addEventListener('click', home);
  routeRendering = false;
}
function tomorrowIso() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
async function renderCheckout() {
  routeRendering = true;
  const lines = readCart();
  if (!lines.length) {
    history.replaceState({ catalog: 'cart' }, '', cartUrl());
    await renderCart();
    return;
  }
  setMeta('Checkout | DecoCake.my', 'Semak butiran wording, saiz dan maklumat penerima.');
  const summary = lines.map((line) => `<div class="catalog-checkout-item"><b>${esc(line.title)} × ${line.qty}</b><small>${lineDetails(line)}</small><small>${money(line.unitPrice * line.qty)}</small></div>`).join('');
  root.innerHTML = shell('Checkout', `<main class="catalog-route-main"><div class="catalog-checkout-layout"><section class="catalog-checkout-card catalog-checkout-customer"><h2>Maklumat pelanggan</h2><form id="catalogCheckoutForm" class="catalog-checkout-form"><label>Nama penuh<input name="name" autocomplete="name" required></label><label>Nombor telefon<input name="phone" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXX" required></label><label>Tarikh diperlukan<input name="dateNeed" type="date" min="${tomorrowIso()}" value="${tomorrowIso()}" required></label><label>Penghantaran<select name="delivery"><option value="pickup">Pickup</option><option value="postage">Postage</option></select></label><div id="catalogAddressFields" hidden><label>Alamat<textarea name="address" autocomplete="street-address"></textarea></label><label>Bandar<input name="city" autocomplete="address-level2"></label><label>Poskod<input name="postcode" inputmode="numeric" autocomplete="postal-code"></label><label>Negeri<input name="state" autocomplete="address-level1"></label></div><div id="catalogCheckoutError" class="catalog-form-error"></div><div id="catalogSubmitState" class="catalog-submit-state">Sedang membuat order…</div><button type="submit">Buat Order · ${money(cartTotal(lines))}</button></form></section><aside class="catalog-checkout-card catalog-checkout-summary"><h2>Semak order</h2>${summary}<div class="catalog-checkout-total"><span>Jumlah</span><b>${money(cartTotal(lines))}</b></div></aside></div></main>`);
  bindShell();
  const form = document.querySelector<HTMLFormElement>('#catalogCheckoutForm')!;
  const addressFields = document.querySelector<HTMLElement>('#catalogAddressFields')!;
  const delivery = form.elements.namedItem('delivery') as HTMLSelectElement;
  const toggleAddress = () => {
    const postage = delivery.value === 'postage';
    addressFields.hidden = !postage;
    addressFields.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea').forEach((input) => { input.required = postage; });
  };
  delivery.addEventListener('change', toggleAddress);
  toggleAddress();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const errorNode = document.querySelector<HTMLElement>('#catalogCheckoutError')!;
    const stateNode = document.querySelector<HTMLElement>('#catalogSubmitState')!;
    errorNode.classList.remove('show');
    stateNode.classList.add('show');
    const data = new FormData(form);
    const payload = {
      customer: {
        name: String(data.get('name') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        address_line1: String(data.get('address') || '').trim(),
        city: String(data.get('city') || '').trim(),
        postcode: String(data.get('postcode') || '').trim(),
        state: String(data.get('state') || '').trim(),
      },
      date_need: String(data.get('dateNeed') || ''),
      delivery: String(data.get('delivery') || 'pickup'),
      payment: 'QR Pay',
      total: cartTotal(lines),
      notify_whatsapp: true,
      source: 'catalog_customer',
      items: lines.map((line) => ({
        catalogSlug: line.catalogSlug,
        productId: line.productId,
        catalogClickupTaskId: line.catalogClickupTaskId,
        k: line.productType,
        title: line.title,
        wordingMode: line.wordingMode,
        customText: line.customText,
        sizeCode: line.sizeCode,
        size: line.sizeLabel,
        qty: line.qty,
        price: line.unitPrice,
        reviewRequired: line.reviewRequired,
      })),
    };
    try {
      const { data: result, error } = await (supabase as any).rpc('icetak_create_order', { payload });
      if (error) throw error;
      if (!result?.success || !result?.order_token) throw new Error('Order tidak berjaya dibuat.');
      writeCart([]);
      const url = baseUrl();
      url.searchParams.set('order', result.order_token);
      location.href = url.toString();
    } catch (error) {
      console.error('Catalogue checkout failed', error);
      const message = error instanceof Error ? error.message : 'Checkout gagal. Sila cuba lagi.';
      errorNode.textContent = message
        .replace('custom_wording_required', 'Wording custom wajib diisi.')
        .replace('product_size_required', 'Saiz produk wajib dipilih.')
        .replace('catalog_product_not_orderable', 'Produk ini belum tersedia untuk order.');
      errorNode.classList.add('show');
      stateNode.classList.remove('show');
    }
  };
  routeRendering = false;
}
function openBasic(slug: string) {
  const key = BASIC_BY_SLUG[slug];
  if (!key || basicOpened === slug) return;
  const element = document.querySelector<HTMLElement>(`[data-k="${key}"],[data-cat="${key}"]`);
  if (!element) return;
  basicOpened = slug;
  element.click();
  setMeta(`${BASIC_LABEL[key]} | DecoCake.my`, `${BASIC_LABEL[key]} custom daripada DecoCake.my.`);
}
function injectSearch() {
  const catalog = document.querySelector<HTMLElement>('main.catalog');
  if (!catalog || catalog.dataset.searchReady) return;
  catalog.dataset.searchReady = '1';
  const form = document.createElement('form');
  form.className = 'catalog-home-search';
  form.innerHTML = '<span>⌕</span><input name="q" placeholder="Cari Spiderman, Frozen, bola…" aria-label="Cari produk" required><button>Cari</button>';
  form.onsubmit = (event) => {
    event.preventDefault();
    const q = String(new FormData(form).get('q') || '').trim();
    if (q) {
      history.pushState({ catalog: 'search' }, '', searchUrl(q));
      void renderSearch(q);
    }
  };
  catalog.prepend(form);
}
function injectBasicShare() {
  const route = queryRoute();
  if (route.kind !== 'product' || !BASIC_BY_SLUG[route.value]) return;
  const detailCard = document.querySelector<HTMLElement>('.detail-page .detail-card');
  if (!detailCard || detailCard.querySelector('.basic-share-link')) return;
  const key = BASIC_BY_SLUG[route.value];
  const title = BASIC_LABEL[key];
  const url = productUrl(route.value);
  const button = document.createElement('button');
  button.className = 'basic-share-link';
  button.type = 'button';
  button.textContent = 'Kongsi produk';
  button.setAttribute('aria-label', `Kongsi ${title}`);
  button.onclick = () => void shareProduct(title, `${title} custom daripada DecoCake.my.`, url, button);
  detailCard.append(button);
}
function injectFloatingCart() {
  let button = document.querySelector<HTMLButtonElement>('#catalogFloatingCart');
  const count = cartCount();
  if (!count) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement('button');
    button.id = 'catalogFloatingCart';
    button.className = 'catalog-floating-cart';
    button.onclick = () => {
      history.pushState({ catalog: 'cart' }, '', cartUrl());
      void renderCart();
    };
    document.body.append(button);
  }
  button.innerHTML = `Cart <b>${count}</b>`;
}
function updateCartIndicators() {
  document.querySelectorAll<HTMLElement>('.catalog-cart-count').forEach((node) => { node.textContent = String(cartCount()); });
  injectFloatingCart();
}
function applyRoute() {
  const route = queryRoute();
  if (route.kind === 'search') {
    if (!routeRendering) void renderSearch(route.value);
    return;
  }
  if (route.kind === 'cart') {
    if (!routeRendering) void renderCart();
    return;
  }
  if (route.kind === 'checkout') {
    if (!routeRendering) void renderCheckout();
    return;
  }
  if (route.kind === 'product') {
    if (BASIC_BY_SLUG[route.value]) {
      openBasic(route.value);
      injectBasicShare();
    } else if (!routeRendering) void renderCatalogProduct(route.value);
    return;
  }
  basicOpened = '';
  injectSearch();
  injectFloatingCart();
}

document.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-k],[data-cat],[data-jump]');
  if (!target) return;
  const key = (target.dataset.k || target.dataset.cat || target.dataset.jump) as BasicKey | undefined;
  if (!key || !BASIC[key]) return;
  const url = baseUrl();
  url.hash = `/product/${BASIC[key]}`;
  history.replaceState(history.state, '', url);
}, true);
window.addEventListener('popstate', () => setTimeout(applyRoute));
window.addEventListener('hashchange', () => setTimeout(applyRoute));
window.addEventListener('storage', (event) => { if (event.key === CART_KEY) updateCartIndicators(); });
const observer = new MutationObserver(() => {
  const route = queryRoute();
  if (route.kind === 'none') injectSearch();
  else if (route.kind === 'product' && BASIC_BY_SLUG[route.value]) {
    openBasic(route.value);
    injectBasicShare();
  }
});
ensureStyles();
observer.observe(root, { childList: true, subtree: true });
setTimeout(applyRoute);
