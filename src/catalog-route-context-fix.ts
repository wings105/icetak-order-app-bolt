export {};

declare global {
  interface Window {
    __ICETAK_CATALOG_ROUTE_CONTEXT_FIX__?: boolean;
  }
}

if (!window.__ICETAK_CATALOG_ROUTE_CONTEXT_FIX__) {
  window.__ICETAK_CATALOG_ROUTE_CONTEXT_FIX__ = true;

  const CONTEXT_PARAMS = [
    'order',
    'c',
    'confirm',
    'login',
    'magic_token',
    'token',
    'q',
    'product',
  ];

  function rememberCustomerToken(url = new URL(location.href)) {
    const token = url.searchParams.get('c');
    if (token) localStorage.setItem('customer_token', token);
  }

  function cleanCatalogHomeUrl() {
    const url = new URL(location.href);
    rememberCustomerToken(url);
    CONTEXT_PARAMS.forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return url;
  }

  function replaceWithCleanCatalogUrl() {
    const clean = cleanCatalogHomeUrl();
    if (clean.toString() === location.href) return;
    const current = (history.state && typeof history.state === 'object') ? history.state : {};
    history.replaceState({ ...current, page: 'catalog', orderToken: '' }, '', clean);
  }

  function buildSearchUrl(query: string) {
    const url = cleanCatalogHomeUrl();
    url.searchParams.set('q', query);
    return url;
  }

  function injectSearchFallback(catalog: HTMLElement) {
    if (catalog.querySelector('.catalog-home-search')) return;

    const form = document.createElement('form');
    form.className = 'catalog-home-search';
    form.dataset.catalogContextSearch = '1';
    form.innerHTML = '<span>⌕</span><input name="q" placeholder="Cari Spiderman, Frozen, bola…" aria-label="Cari produk" required><button>Cari</button>';
    form.onsubmit = (event) => {
      event.preventDefault();
      const query = String(new FormData(form).get('q') || '').trim();
      if (!query) return;
      location.assign(buildSearchUrl(query).toString());
    };
    catalog.prepend(form);
  }

  function enhanceCatalogHome() {
    const catalog = document.querySelector<HTMLElement>('main.catalog');
    if (!catalog) return;
    replaceWithCleanCatalogUrl();
    injectSearchFallback(catalog);
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const homeControl = target.closest('#navHome,#catalogHome,[data-catalog-home]');
    if (homeControl) {
      replaceWithCleanCatalogUrl();
      return;
    }

    const productControl = target.closest('[data-k],[data-cat],[data-jump],[data-catalog-product]');
    if (!productControl) return;

    const url = new URL(location.href);
    rememberCustomerToken(url);
    ['order', 'c', 'confirm', 'login', 'magic_token', 'token'].forEach((key) => url.searchParams.delete(key));
    if (url.toString() !== location.href) history.replaceState(history.state, '', url);
  }, true);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      enhanceCatalogHome();
    }, 0);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('DOMContentLoaded', schedule);
  schedule();
}
