import { installTransport } from './transport.mjs';
installTransport(globalThis.fetch.bind(globalThis));
// Pin the existing worker and guards. Supabase bundles this immutable source at deployment.
// No changes to queue, QC, image billing reservation, attachment verification or CF writes.
await import('https://raw.githubusercontent.com/wings105/icetak-order-app-bolt/e5fbd5083b88ee91a2915607266e9b1db151911d/supabase/functions/acrylic-auto-image/index.ts');
