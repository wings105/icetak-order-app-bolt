import { installTransport } from './transport.mjs';
installTransport(globalThis.fetch.bind(globalThis));
await import('./worker.ts');
