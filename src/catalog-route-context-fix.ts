export {};

declare global {
  interface Window {
    __ICETAK_CATALOG_ROUTE_CONTEXT_FIX__?: boolean;
  }
}

if (!window.__ICETAK_CATALOG_ROUTE_CONTEXT_FIX__) {
  window.__ICETAK_CATALOG_ROUTE_CONTEXT_FIX__ = true;

  const SESSION_PARAMS = ['order', 'c', 'confirm', 'login', 'magic_token', 'token'];
  const HOME_PARAMS = [...SESSION_PARAMS, 'q', 'product'];

  function currentState() {
    return history.state && typeof history.state === 'object' ? history.state : {};
  }

  function rememberCustomerToken(url = new URL(location.href)) {
    const token = url.searchParams.get('c');
    if (token) localStorage.setItem('customer_token', token);
  }

  function routeKind(url = new URL(location.href)) {
    const hash = decodeURIComponent(url.hash.replace(/^#\/?/, ''));
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (url.searchParams.get('q') || /^search\/.+/.test(hash) || /^search\/.+/.test(path)) return 'search';
    if (url.searchParams.get('product') || /^product\/.+/.test(hash) || /^product\/.+/.test(path)) return 'product';
    return 'none';
  }

  function cleanRouteUrl(source = new URL(location.href)) {
    const url = new URL(source);
    rememberCustomerToken(url);
    SESSION_PARAMS.forEach((key) => url.searchParams.delete(key));
    return url;
  }

  function cleanCatalogHomeUrl(source = new URL(location.href)) {
    const url = new URL(source);
    rememberCustomerToken(url);
    HOME_PARAMS.forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return url;
  }

  function replaceWithCleanCatalogUrl() {
    const clean = cleanCatalogHomeUrl();
    if (clean.toString() === location.href) return;
    history.replaceState({ ...currentState(), page: 'catalog', orderToken: '' }, '', clean);
  }

  function primeDirectCatalogRoute() {
    const source = new URL(location.href);
    const kind = routeKind(source);
    if (kind === 'none') return;

    const target = cleanRouteUrl(source);
    const state = currentState();

    if (state.catalogBackPrimed) {
      if (target.toString() !== location.href) history.replaceState(state, '', target);
      return;
    }

    const home = cleanCatalogHomeUrl(target);
    history.replaceState(
      { ...state, page: 'catalog', orderToken: '', catalogHome: true },
      '',
      home,
    );
    history.pushState(
      { ...state, page: 'catalog', orderToken: '', catalogRoute: kind, catalogBackPrimed: true },
      '',
      target,
    );
  }

  function buildSearchUrl(query: string) {
    const url = cleanCatalogHomeUrl();
    url.searchParams.set('q', query);
    return url;
  }

  function dedupeSearchForms(catalog: HTMLElement) {
    const forms = Array.from(catalog.querySelectorAll<HTMLFormElement>('.catalog-home-search'));
    if (forms.length <= 1) return;
    const native = forms.find((form) => !form.dataset.catalogContextSearch);
    const keep = native || forms[0];
    forms.forEach((form) => {
      if (form !== keep) form.remove();
    });
  }

  function injectSearchFallback(catalog: HTMLElement) {
    dedupeSearchForms(catalog);
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
    catalog.dataset.searchReady = '1';
    catalog.prepend(form);
  }

  function enhanceCatalogHome() {
    const catalog = document.querySelector<HTMLElement>('main.catalog');
    if (!catalog) return;

    replaceWithCleanCatalogUrl();
    dedupeSearchForms(catalog);

    window.setTimeout(() => {
      if (!document.body.contains(catalog)) return;
      dedupeSearchForms(catalog);
      injectSearchFallback(catalog);
      dedupeSearchForms(catalog);
    }, 180);
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

    const url = cleanRouteUrl();
    if (url.toString() !== location.href) history.replaceState(currentState(), '', url);
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

  primeDirectCatalogRoute();

  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('DOMContentLoaded', schedule);
  schedule();
}
