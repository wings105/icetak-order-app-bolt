import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const regex = /(?:^|[^A-Z0-9])([0-9]{6}(?=[A-Z0-9]{0,7}[A-Z])[A-Z0-9]{8})(?=$|[^A-Z0-9])/g;
const extract = (text) => [...new Set([...text.toUpperCase().matchAll(regex)].map((match) => match[1]))];

assert.deepEqual(extract('26091554C8GHFJ'), ['26091554C8GHFJ']);
assert.deepEqual(extract('order saya 26091554c8ghfj boleh semak?'), ['26091554C8GHFJ']);
assert.deepEqual(extract('26091554C8GHFJ dan 2609167HA0WHR1'), ['26091554C8GHFJ', '2609167HA0WHR1']);
assert.deepEqual(extract('A26091554C8GHFJ'), []);
assert.deepEqual(extract('26091554C8GHFJ9'), []);
assert.deepEqual(extract('12345678901234'), []);

const [receiver, detector, settings] = await Promise.all([
  readFile(new URL('../supabase/functions/whatsapp-order-id-forward/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/unified-inbox/wasapflow-raw/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/webhook-forward-settings/index.ts', import.meta.url), 'utf8'),
]);
assert.match(receiver, /idempotency_key/);
assert.match(receiver, /whatsapp_order_id_phone_webhook_url/);
assert.match(detector, /eventName !== "message\.received"/);
assert.match(settings, /order_id_phone/);

console.log('WhatsApp Order ID forward checks passed.');
