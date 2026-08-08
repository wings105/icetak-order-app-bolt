import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/main.ts';
const original = readFileSync(path, 'utf8');
let lines = original.split('\n');

const dropPrefixes = [
  "import './admin-quick-arrange';",
  'async function adminLogin(',
  'async function loadAdmin(',
  'async function adminAction(',
  'function editAdminOrder(',
  'async function saveAdminPermissions(',
  'async function generatePaymentWebhookKey(',
  'function downloadFile(',
  'async function exportAdminData(',
  'function adminCreateOrder(',
  'function adminPage(',
];

lines = lines.filter((line) => !dropPrefixes.some((prefix) => line.startsWith(prefix)));

lines = lines.map((line) => {
  if (line.startsWith("type K='edible'")) {
    return line
      .replace("|'admin'|'quick-arrange'", '')
      .replace("|'quick-arrange'|'admin'", '');
  }

  if (line.startsWith("const root=document.querySelector<HTMLDivElement>('#app')!;const WA=")) {
    const start = line.indexOf('type AdminOrder=');
    const endMarker = "selectedCustomerToken='';";
    const end = line.indexOf(endMarker);
    if (start !== -1 && end !== -1) {
      return line.slice(0, start) + line.slice(end + endMarker.length);
    }
  }

  if (line.startsWith('function accessPage()')) {
    const legacy = "document.querySelector<HTMLButtonElement>('#staffLogin')!.onclick=()=>{navigate('admin');if(adminSession)void loadAdmin()}";
    const next = "document.querySelector<HTMLButtonElement>('#staffLogin')!.onclick=()=>{const u=new URL(location.href);u.searchParams.set('admin','v2');location.assign(u)}";
    if (!line.includes(legacy)) throw new Error('Legacy staff-login handler not found');
    return line.replace(legacy, next);
  }

  if (line.startsWith('function render()')) {
    return line.replace(":page==='admin'?adminPage()", '');
  }

  return line;
});

const output = lines.join('\n');
const forbidden = [
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
for (const marker of forbidden) {
  if (output.includes(marker)) throw new Error(`Legacy admin marker still exists: ${marker}`);
}

const requiredCustomerMarkers = [
  'function catalog()',
  'function review()',
  'function customerForm()',
  'function historyPage()',
  'function orderPage()',
  'function paymentPage()',
  'function confirmPage()',
  'function accessPage()',
  'async function createOrderNow(',
  'async function bootstrap()',
];
for (const marker of requiredCustomerMarkers) {
  if (!output.includes(marker)) throw new Error(`Customer marker missing after cleanup: ${marker}`);
}

if (output === original) {
  console.log('src/main.ts already has no legacy Admin V1 block.');
} else {
  writeFileSync(path, output);
  console.log(`Stripped legacy Admin V1 from src/main.ts: ${original.length} -> ${output.length} bytes`);
}
