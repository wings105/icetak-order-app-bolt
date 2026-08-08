import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const fail = (message) => {
  console.error(`\n❌ Admin V2 source-of-truth check failed:\n${message}\n`);
  process.exitCode = 1;
};

const index = readFileSync('index.html', 'utf8');
if (!index.includes('./src/admin-v2-route.tsx')) fail('index.html must load ./src/admin-v2-route.tsx');

const forbiddenIndexRefs = [
  'admin-auth-ui.ts',
  'admin-route-bridge.ts',
  'admin-order-lifecycle.ts',
  'admin-auto-notification-ui.ts',
  'admin-whatsapp-paid-order',
  'admin-quick-arrange.ts',
  'wasapflow-control-center',
  'whatsapp-control-production-audit.ts',
  'whatsapp-control-connection-guard.ts',
  'whatsapp-queue-worker.ts',
];
for (const marker of forbiddenIndexRefs) {
  if (index.includes(marker)) fail(`index.html references retired Admin V1 runtime: ${marker}`);
}

const srcFiles = readdirSync('src');
const allowedAdminBridge = new Set(['admin-v2-route.tsx']);
for (const file of srcFiles) {
  if (file.startsWith('admin-') && !allowedAdminBridge.has(file)) {
    fail(`Admin UI/business logic must not be added under src/: src/${file}. Put it under icetak-admin/.`);
  }
  if (/^wasapflow-control-center/i.test(file) || file === 'whatsapp-queue-worker.ts') {
    fail(`Retired Admin V1 module exists under src/: src/${file}`);
  }
}

const main = readFileSync('src/main.ts', 'utf8');
const forbiddenMainMarkers = [
  'function adminPage(',
  'async function adminLogin(',
  'function adminCreateOrder(',
  'type AdminOrder=',
  'type AdminInfo=',
  'adminSession=',
  "navigate('admin')",
  "page==='admin'",
  "'quick-arrange'",
];
for (const marker of forbiddenMainMarkers) {
  if (main.includes(marker)) fail(`src/main.ts contains retired admin logic: ${marker}`);
}

const requiredV2 = [
  'icetak-admin/src/App.tsx',
  'icetak-admin/src/AdminLogin.tsx',
  'icetak-admin/src/pages/Orders.tsx',
  'icetak-admin/src/pages/QuickOrder.tsx',
  'icetak-admin/src/pages/ManualOrder.tsx',
  'icetak-admin/src/pages/Payments.tsx',
  'icetak-admin/src/pages/Shipping.tsx',
  'icetak-admin/src/pages/WhatsAppControl.tsx',
  'icetak-admin/src/pages/StaffRoles.tsx',
  'icetak-admin/src/pages/Settings.tsx',
];
for (const file of requiredV2) {
  if (!existsSync(file)) fail(`Required Admin V2 source missing: ${file}`);
}

if (!process.exitCode) {
  console.log('✅ Admin V2 source of truth is clean.');
  console.log('   Admin UI/business logic: icetak-admin/');
  console.log('   Admin mount/auth bridge: src/admin-v2-route.tsx');
  console.log('   Customer app: src/main.ts + customer scripts');
}
