import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const playwright=await import(process.env.FINANCE_PLAYWRIGHT_MODULE||'playwright');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:5175,strictPort:true}});await server.listen();
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.FINANCE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
const out='/tmp/finance-sales-sku-qa';fs.mkdirSync(out,{recursive:true});const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
try{
 await p.goto('http://127.0.0.1:5175/tests/order-profit.html?view=finance');await p.getByRole('button',{name:'Sales SKU',exact:true}).click();await p.getByRole('button',{name:'Butiran QA-A'}).waitFor();
 assert.match(await p.locator('.sku-kpis').innerText(),/320/);assert.match(await p.locator('.sku-table-wrap tbody tr').first().innerText(),/12\s+2\s+10\s+8/);
 for(const label of ['1 hari','1 minggu','1 bulan','3 bulan','6 bulan','1 tahun','Keseluruhan']){await p.getByRole('button',{name:label,exact:true}).click();await p.getByRole('button',{name:'Butiran QA-A'}).waitFor();assert.equal(await p.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');}
 assert.equal(await p.getByLabel('Dari',{exact:true}).inputValue(),'');await p.getByRole('button',{name:'1 minggu',exact:true}).click();await p.getByRole('button',{name:'Butiran QA-A'}).waitFor();const to=await p.getByLabel('Hingga').inputValue(),from=await p.getByLabel('Dari',{exact:true}).inputValue();assert.equal((Date.parse(to)-Date.parse(from))/86400000,6);
 await p.getByLabel('Susun mengikut').selectOption('sales');assert.equal(await p.locator('.sku-bars button').first().getAttribute('aria-label'),'Butiran QA-B');
 await p.getByLabel('Susun mengikut').selectOption('profit');assert.equal(await p.locator('.sku-bars button').count(),1);await p.getByText('SKU dengan nilai belum lengkap tidak dipaparkan dalam graf.').waitFor();
 await p.getByLabel('Cari SKU / produk').fill('Topper');assert.equal(await p.locator('.sku-table-wrap').first().locator('tbody tr').count(),1);const download=p.waitForEvent('download');await p.getByRole('button',{name:'Eksport CSV'}).click();const d=await download;await d.saveAs(path.join(out,'export.csv'));const csv=fs.readFileSync(path.join(out,'export.csv'),'utf8');assert(csv.includes('QA-A')&&!csv.includes('QA-B'));
 await p.getByLabel('Cari SKU / produk').fill('');await p.getByRole('button',{name:'Butiran QA-A'}).click();await p.getByText('Order untuk QA-A',{exact:true}).waitFor();await p.getByRole('button',{name:'QA-ORDER-001',exact:true}).click();await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape');await p.getByRole('button',{name:'Semua SKU',exact:true}).click();
 await p.getByLabel('Susun mengikut').selectOption('net_units');await p.evaluate(()=>document.querySelector('.content-area').scrollTop=0);await p.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 await p.getByLabel('Cari SKU / produk').fill('not-found');await p.getByText('Tiada SKU untuk pilihan ini.').waitFor();await p.getByLabel('Cari SKU / produk').fill('');
 await p.setViewportSize({width:390,height:844});await p.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);await p.evaluate(()=>document.querySelector('.content-area').scrollTop=0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 await p.getByLabel('Dari',{exact:true}).fill('2026-10-01');await p.getByRole('button',{name:'Butiran QA-A'}).waitFor();assert.equal(await p.getByRole('button',{name:'Tarikh sendiri',exact:true}).getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: all periods, net units/returns, metric ranking, incomplete profit, search, CSV, SKU/order drilldown, custom dates, desktop/mobile, no runtime errors');
}finally{await browser.close();await server.close()}
