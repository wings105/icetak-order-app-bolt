const CUSTOMER_PUBLIC_TOKEN_FILTER = /^eq\.c_[0-9a-f]{16,}$/i;

/**
 * Older guest-checkout code stores a customer public token (c_...) in the
 * browser, but two legacy PostgREST reads treated it as the UUID primary key.
 * Keep the public token opaque and route those reads to the correct columns.
 */
export function rewriteLegacyCustomerTokenUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (!url.pathname.includes('/rest/v1/')) return rawUrl;

    if (url.pathname.endsWith('/rest/v1/customers')) {
      const idFilter = url.searchParams.get('id') || '';
      if (CUSTOMER_PUBLIC_TOKEN_FILTER.test(idFilter)) {
        url.searchParams.delete('id');
        url.searchParams.set('public_token', idFilter);
      }
    }

    if (url.pathname.endsWith('/rest/v1/orders')) {
      const customerIdFilter = url.searchParams.get('customer_id') || '';
      if (CUSTOMER_PUBLIC_TOKEN_FILTER.test(customerIdFilter)) {
        url.searchParams.delete('customer_id');
        url.searchParams.set('customer_token', customerIdFilter);
      }
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

const originalFetch = window.fetch.bind(window);

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' || input instanceof URL) {
    return originalFetch(rewriteLegacyCustomerTokenUrl(input.toString()), init);
  }

  if (input instanceof Request) {
    const rewrittenUrl = rewriteLegacyCustomerTokenUrl(input.url);
    if (rewrittenUrl !== input.url) {
      return originalFetch(new Request(rewrittenUrl, input), init);
    }
  }

  return originalFetch(input, init);
}) as typeof window.fetch;
