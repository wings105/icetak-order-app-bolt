import './product-catalog.css';
import {customerProductTitle} from './catalog-display';
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
  source: string;kind?:string;priceMin?:number;priceMax?:number;available?:boolean;
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
  total_count?: number | string;kind?:string;price_min?:number;price_max?:number;available?:boolean;
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
    displayTitle: customerProductTitle(row.display_title),
    title: row.title,
    description: row.description || '',
    category: row.category || 'Produk',
    parentSku: row.parent_sku || '',
    shopeeProductId: row.shopee_product_id || '',
    imageUrl: row.image_url || './icon.svg',
    shopeeUrl: row.shopee_url || '',
    clickupTaskId: row.clickup_task_id || '',
    source: row.source || 'supabase',kind:row.kind,priceMin:row.price_min,priceMax:row.price_max,available:row.available,
  };
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
      if (button.closest('.catalog-utility-actions')) {
        button.setAttribute('aria-label', 'Link disalin');
        button.dataset.copied = 'true';
        window.setTimeout(() => { button.setAttribute('aria-label','Kongsi produk'); delete button.dataset.copied; },1800);
        return;
      }
      const original = button.textContent || 'Kongsi produk';
      button.textContent = 'Link disalin ✓';
      window.setTimeout(() => { button.textContent = original; }, 1800);
    }
  } catch {
    window.prompt('Salin link produk:', url);
  }
}
function queryRoute() {
  const url = new URL(location.href);
  if (url.searchParams.has('order') || url.searchParams.has('confirm') || url.searchParams.has('login')) return { kind: 'none' as const, value: '' };
  const q = url.searchParams.get('q')?.trim();
  if (q || url.searchParams.has('catalog')) return { kind: 'search' as const, value: q || '' };
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
  ['q', 'product','catalog','category','sort','page'].forEach((key) => url.searchParams.delete(key));
  url.hash = '';
  if (/^\/(product|search)\//.test(url.pathname)) url.pathname='/';
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
const CATEGORY_LABELS: Record<string,string> = {printed:'Cake Topper Glossy',edible:'Edible Image',acrylic:'Acrylic',mirror:'Mirror Gold',wafer:'Wafer Paper',burnaway:'Burn Away'};
function priceLabel(product:CatalogProduct){
  if(product.priceMin==null)return 'Lihat pilihan';
  const format=(n:number)=>`RM${Number(n).toFixed(Number.isInteger(Number(n))?0:2)}`;
  return product.priceMax!=null&&Number(product.priceMax)>Number(product.priceMin)?`${format(product.priceMin)} – ${format(product.priceMax)}`:format(product.priceMin);
}
function card(product: CatalogProduct) {
  return `<article class="catalog-result-card"><button data-catalog-product="${esc(product.slug)}"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}" loading="lazy"><span class="catalog-source">${esc(CATEGORY_LABELS[product.kind||'']||product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${product.parentSku ? `SKU ${esc(product.parentSku)}` : ''}</p><b>${esc(priceLabel(product))}</b>${product.available===false?'<small class="catalog-sold-out">Tidak tersedia buat sementara</small>':''}</button></article>`;
}
async function searchProducts(q:string,kind='',sort='relevance',page=0,limit=24){
 const {data,error}=await supabase.rpc('icetak_store_catalog' as never,{p_query:q,p_kind:kind,p_sort:sort,p_offset:page*limit,p_limit:limit} as never);
 if(error)throw error;
 const result=data as unknown as {rows:SearchRow[];total:number;categories:Record<string,number>};
 return {items:(result.rows||[]).map(rowToProduct),total:Number(result.total||0),categories:result.categories||{}};
}
function browseUrl(q='',kind='',sort='relevance',page=0){
 const url=baseUrl();url.searchParams.set('catalog','1');if(q)url.searchParams.set('q',q);if(kind)url.searchParams.set('category',kind);if(sort!=='relevance')url.searchParams.set('sort',sort);if(page)url.searchParams.set('page',String(page));return url.toString();
}
function bindCards(container:HTMLElement){container.querySelectorAll<HTMLButtonElement>('[data-catalog-product]').forEach(button=>button.onclick=()=>navigateProduct(button.dataset.catalogProduct!));}
let homeCatalogue:ReturnType<typeof searchProducts>|undefined;
async function injectShop(){
 const catalog=document.querySelector<HTMLElement>('main.catalog');if(!catalog||catalog.querySelector('.catalog-shop-section'))return;
 const section=document.createElement('section');section.className='catalog-shop-section';section.setAttribute('aria-label','Katalog design');
 catalog.querySelector('.quick-nav')?.insertAdjacentElement('afterend',section);if(!section.isConnected)catalog.append(section);
 section.innerHTML='<p role="status">Memuatkan katalog…</p>';
 try{
  homeCatalogue ||= searchProducts('','','relevance',0,12).catch(error=>{homeCatalogue=undefined;throw error;});const result=await homeCatalogue;if(!section.isConnected)return;
  section.innerHTML=`<div class="catalog-shop-heading"><h2>Katalog design</h2><a href="${esc(browseUrl())}">Lihat semua ${result.total} produk ›</a></div><nav class="catalog-category-chips" aria-label="Kategori design">${Object.entries(CATEGORY_LABELS).filter(([kind])=>result.categories[kind]>0).map(([kind,label])=>`<a href="${esc(browseUrl('',kind))}">${esc(label)} <small>${result.categories[kind]}</small></a>`).join('')}</nav><div class="catalog-results">${result.items.map(card).join('')}</div>`;
  bindCards(section);
 }catch{if(section.isConnected)section.innerHTML=`<p>Katalog belum dapat dimuatkan. <button data-retry-shop>Cuba lagi</button></p>`;section.querySelector('button')?.addEventListener('click',()=>{section.remove();void injectShop();});}
}
async function getProduct(slug: string) {
  const { data, error } = await supabase
    .from('products')
    .select('slug,display_name,name,source_title,description,parent_sku,shopee_product_id,main_image_url,shopee_url,clickup_task_id,source,metadata,product_categories(name)')
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
    description: (data as any).metadata?.website_description || (data as any).description,
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
let searchGeneration=0;
async function renderSearch(q:string){
 const generation=++searchGeneration;routeRendering=true;loading(q?`Carian: ${q}`:'Semua produk');
 const url=new URL(location.href),kind=url.searchParams.get('category')||'',sort=url.searchParams.get('sort')||'relevance',page=Math.max(0,Number(url.searchParams.get('page'))||0);
 try{
  const data=await searchProducts(q,kind,sort,page);if(generation!==searchGeneration)return;
  setMeta(`${q||CATEGORY_LABELS[kind]||'Semua Produk'} | DecoCake.my`,'Pilih design, variasi dan wording untuk tempahan anda.');
  root.innerHTML=shell(q?`Carian “${q}”`:CATEGORY_LABELS[kind]||'Semua produk',`<main class="catalog-route-main"><form id="catalogRouteSearch" class="catalog-route-search"><input name="q" value="${esc(q)}" placeholder="Cari design, SKU atau Product ID" aria-label="Cari produk"><button>Cari</button></form>
  <nav class="catalog-category-chips" aria-label="Kategori produk"><a class="${kind?'':'active'}" href="${esc(browseUrl(q,'',sort))}">Semua</a>${Object.entries(CATEGORY_LABELS).map(([key,label])=>`<a class="${kind===key?'active':''}" href="${esc(browseUrl(q,key,sort))}">${esc(label)} <small>${data.categories[key]||0}</small></a>`).join('')}</nav>
  <div class="catalog-browse-toolbar"><span><b>${data.total.toLocaleString()}</b> produk</span><label>Susun <select id="catalogSort" aria-label="Susun produk">${[['relevance','Paling berkaitan'],['price_asc','Harga rendah dahulu'],['price_desc','Harga tinggi dahulu'],['title','Nama produk'],['newest','Terbaru']].map(([value,label])=>`<option value="${value}" ${sort===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
  ${data.items.length?`<section class="catalog-results">${data.items.map(card).join('')}</section>`:`<section class="catalog-empty"><b>Tiada produk dijumpai</b><p>Cuba kata carian atau kategori lain.</p><a href="${esc(browseUrl())}">Lihat semua produk</a></section>`}
  <nav class="catalog-pagination" aria-label="Halaman produk">${page?`<a href="${esc(browseUrl(q,kind,sort,page-1))}">‹ Sebelum</a>`:'<span></span>'}<span>${data.total?Math.min(page*24+1,data.total):0}–${Math.min((page+1)*24,data.total)} / ${data.total}</span>${(page+1)*24<data.total?`<a href="${esc(browseUrl(q,kind,sort,page+1))}">Seterusnya ›</a>`:'<span></span>'}</nav></main>`);
  bindShell();bindCards(root);
  document.querySelector<HTMLFormElement>('#catalogRouteSearch')!.onsubmit=event=>{event.preventDefault();const next=String(new FormData(event.currentTarget as HTMLFormElement).get('q')||'').trim();location.assign(browseUrl(next,kind,sort));};
  document.querySelector<HTMLSelectElement>('#catalogSort')!.onchange=event=>location.assign(browseUrl(q,kind,(event.target as HTMLSelectElement).value));
 }catch(error){if(generation!==searchGeneration)return;console.error('Catalogue search failed',error);root.innerHTML=shell('Katalog','<main class="catalog-route-main"><section class="catalog-empty"><b>Katalog tidak dapat dimuatkan</b><button id="catalogRetry">Cuba lagi</button></section></main>');bindShell();document.querySelector<HTMLButtonElement>('#catalogRetry')!.onclick=()=>void renderSearch(q);}
 finally{if(generation===searchGeneration)routeRendering=false;}
}
async function renderCatalogProduct(slug: string) {
  routeRendering = true;
  loading('Produk');
  try {
    const product = await getProduct(slug);
    setMeta(`${product.displayTitle} | DecoCake.my`, product.description || product.title);
    const url = productUrl(product.slug);
    const wa = `https://wa.me/60179860656?text=${encodeURIComponent(`Hi iCetak, saya berminat dengan produk ini:\n${product.displayTitle}\n${url}`)}`;
    root.innerHTML = shell(product.displayTitle, `<main class="catalog-route-main"><article class="catalog-product-detail"><img src="${esc(product.imageUrl)}" alt="${esc(product.displayTitle)}"><div class="catalog-detail-copy"><span>${esc(product.category)}</span><h2>${esc(product.displayTitle)}</h2><p>${esc(product.description || product.title)}</p>${product.parentSku ? `<small>Parent SKU: ${esc(product.parentSku)}</small>` : ''}<div class="catalog-detail-actions"><a class="primary" href="${wa}" target="_blank" rel="noopener">Tanya melalui WhatsApp</a>${product.shopeeUrl ? `<a href="${esc(product.shopeeUrl)}" target="_blank" rel="noopener">Buka di Shopee</a>` : ''}<button id="shareCatalogProduct" type="button">Kongsi produk</button></div></div></article><section class="catalog-custom-cta"><b>Tak jumpa design tepat?</b><p>Gunakan servis Cake Topper Custom dan hantarkan contoh kepada kami.</p><a href="${esc(productUrl(BASIC.printed))}">Buka Cake Topper Custom</a></section></main>`);
    bindShell();
    const shareButton = document.querySelector<HTMLButtonElement>('#shareCatalogProduct')!;
    shareButton.onclick = () => void shareProduct(
      product.displayTitle,
      product.description || product.title,
      url,
      shareButton,
    );
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
  const key = BASIC_BY_SLUG[route.value];
  const title = BASIC_LABEL[key];
  const url = productUrl(route.value);
  const button = document.createElement('button');
  button.className = 'basic-share-link';
  button.type = 'button';
  button.textContent = 'Kongsi produk';
  button.setAttribute('aria-label', `Kongsi ${title}`);
  button.onclick = () => void shareProduct(
    title,
    `${title} custom daripada DecoCake.my.`,
    url,
    button,
  );
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
  void injectShop();
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
  if (route.kind === 'none') {injectSearch();void injectShop();}
  else if (route.kind === 'product' && BASIC_BY_SLUG[route.value]) {
    openBasic(route.value);
    injectBasicShare();
  }
});
observer.observe(root, { childList: true, subtree: true });
setTimeout(applyRoute);
