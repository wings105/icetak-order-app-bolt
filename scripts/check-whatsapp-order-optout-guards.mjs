import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260826113000_whatsapp_per_order_optout_auto_guard.sql', import.meta.url),
  'utf8',
);
const sender = readFileSync(new URL('../supabase/functions/whatsapp-send/index.ts', import.meta.url), 'utf8');
const dispatcher = readFileSync(new URL('../supabase/functions/whatsapp-dispatch/index.ts', import.meta.url), 'utf8');

for (const eventType of ['order_ready_pickup_auto', 'shipment_auto_tracking']) {
  assert.match(migration, new RegExp(eventType), `${eventType} must be covered by the DB guard`);
}
assert.match(migration, /coalesce\(o\.whatsapp_opt_in,false\)=false/);
assert.match(migration, /icetak_whatsapp_cancel_on_order_opt_out/);
assert.match(migration, /status in \('pending','processing'\)/);
assert.match(migration, /public\.icetak_order_is_cancelled\(o\.id\)/);

assert.match(sender, /tracking_order_opted_out/);
assert.match(sender, /tracking_order_cancelled/);
assert.match(sender, /pickup_order_opted_out/);
assert.equal((sender.match(/trackingAutoPreflight\(body\)/g) || []).length, 2, 'tracking preflight must run twice');
assert.equal((sender.match(/pickupAutoPreflight\(body\)/g) || []).length, 2, 'pickup preflight must run twice');

assert.match(dispatcher, /tracking_\([^\n]*order_opted_out/);
assert.match(dispatcher, /pickup_\([^\n]*order_opted_out/);

console.log('WhatsApp per-order auto opt-out guards passed.');
