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
const root = document.querySelector<HTMLDivElement>('#app')!;
let routeRendering = false;
let basicOpened = '';

function esc(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
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
function queryRoute() {
  const url = new URL(location.href);
  if (url.searchParams.has('order') || url.searchParams.has('confirm') || url.searchParams.has('login')) return { kind: 'none' as const, value: '' };
  const q = url.searchParams.get('q')?.trim();
  if (q) return { kind: 'search' as const, value: q };
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
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
  ['q', 'product'].forEach((key) => url.searchParams.delete(key));
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
function home() {
  location.href = baseUrl().toString();
}
function shell(title: string, body: string) {
  return `<header class="catalog-route-head"><button id="catalogBack" aria-label="Kembali">‹</button><div><small>DecoCake.my</small><h1>${esc(title)}</h1></div><button id="catalogHome">⌂</button></header>${body}`;
}
function bindShell() {
  document.querySelector<HTMLButtonElement>('#catalogBack')?.addEventListener('click', () => (history.length > 1 ? history.back() : home()));
  document.querySelector<HTMLButtonElement>('#catalogHome')?.addEventListener('click', home);
}
function loading(title: string) {
  root.innerHTML = shell(title, '<main class="catalog-route-main"><div class="catalog-loading"><i></i><b>Sedang cari produk…</b></div></main>');
  bindShell();
}
function card(product: CatalogProduct) {
  return `<article class="catalog-result-card"><button data-catalog-product="${esc(product.slug)}"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}" loading="lazy"><span class="catalog-source">${esc(product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${product.parentSku ? `SKU ${esc(product.parentSku)}` : esc(product.title.slice(0, 100))}</p><b>Lihat produk ›</b></button></article>`;
}
async function searchProducts(q: string) {
  const { data, error } = await supabase.rpc('search_product_catalog' as never, { p_query: q, p_limit: 36, p_offset: 0 } as never);
  if (error) throw error;
  const rows = (data || []) as SearchRow[];
  return { items: rows.map(rowToProduct), total: Number(rows[0]?.total_count || 0) };
}
async function getProduct(slug: string) {
  const { data, error } = await supabase
    .from('products')
    .select('slug,display_name,name,source_title,description,parent_sku,shopee_product_id,main_image_url,shopee_url,clickup_task_id,source,product_categories(name)')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Product not found');
  const categoryValue = (data as any).product_categories;
  const category = Array.isArray(categoryValue) ? categoryValue[0]?.name : categoryValue?.name;
  return rowToProduct({
    slug: (data as any).slug,
    display_title: (data as any).display_name,
    title: (data as any).source_title || (data as any).name,
    description: (data as any).description,
    category: category || 'Produk',
    parent_sku: (data as any).parent_sku,
    shopee_product_id: (data as any).shopee_product_id,
    image_url: (data as any).main_image_url,
    shopee_url: (data as any).shopee_url,
    clickup_task_id: (data as any).clickup_task_id,
    source: (data as any).source,
    total_count: 1,
  });
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
async function renderCatalogProduct(slug: string) {
  routeRendering = true;
  loading('Produk');
  try {
    const product = await getProduct(slug);
    setMeta(`${product.displayTitle} | DecoCake.my`, product.description || product.title);
    const wa = `https://wa.me/60179860656?text=${encodeURIComponent(`Hi iCetak, saya berminat dengan produk ini:\n${product.displayTitle}\n${location.href}`)}`;
    root.innerHTML = shell(product.displayTitle, `<main class="catalog-route-main"><article class="catalog-product-detail"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}"><div class="catalog-detail-copy"><span>${esc(product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${esc(product.description || product.title)}</p>${product.parentSku ? `<small>Parent SKU: ${esc(product.parentSku)}</small>` : ''}<div class="catalog-detail-actions"><a class="primary" href="${wa}" target="_blank" rel="noopener">Tanya melalui WhatsApp</a>${product.shopeeUrl ? `<a href="${esc(product.shopeeUrl)}" target="_blank" rel="noopener">Buka di Shopee</a>` : ''}<button id="copyCatalogLink">Salin link produk</button></div></div></article><section class="catalog-custom-cta"><b>Tak jumpa design tepat?</b><p>Gunakan servis Cake Topper Custom dan hantarkan contoh kepada kami.</p><a href="${esc(productUrl(BASIC.printed))}">Buka Cake Topper Custom</a></section></main>`);
    bindShell();
    document.querySelector<HTMLButtonElement>('#copyCatalogLink')!.onclick = async () => {
      await navigator.clipboard.writeText(location.href);
      document.querySelector<HTMLButtonElement>('#copyCatalogLink')!.textContent = 'Link disalin ✓';
    };
  } catch (error) {
    console.error('Supabase catalogue product failed', error);
    root.innerHTML = shell('Produk tidak dijumpai', '<main class="catalog-route-main"><section class="catalog-empty"><b>Link produk tidak sah atau produk sudah tidak aktif.</b><button id="catalogHomeFromError">Kembali ke katalog</button></section></main>');
    bindShell();
    document.querySelector<HTMLButtonElement>('#catalogHomeFromError')!.onclick = home;
  } finally {
    routeRendering = false;
  }
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
  const button = document.createElement('button');
  button.className = 'basic-share-link';
  button.textContent = 'Salin link produk';
  button.onclick = async () => {
    await navigator.clipboard.writeText(productUrl(route.value));
    button.textContent = 'Link disalin ✓';
  };
  detailCard.append(button);
}
function applyRoute() {
  const route = queryRoute();
  if (route.kind === 'search') {
    if (!routeRendering) void renderSearch(route.value);
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
const observer = new MutationObserver(() => {
  const route = queryRoute();
  if (route.kind === 'none') injectSearch();
  else if (route.kind === 'product' && BASIC_BY_SLUG[route.value]) {
    openBasic(route.value);
    injectBasicShare();
  }
});
observer.observe(root, { childList: true, subtree: true });
setTimeout(applyRoute);
