import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));
const pw=await import(process.env.FINANCE_PLAYWRIGHT_MODULE||'playwright');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:5175,strictPort:true}});await server.listen();
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.FINANCE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
const out='/tmp/sales-channel-qa';fs.mkdirSync(out,{recursive:true});const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
try{
 await p.goto('http://127.0.0.1:5175/tests/order-profit.html?view=finance');await p.getByRole('button',{name:'Sales Channel',exact:true}).click();await p.locator('.channel-cards').waitFor();
 assert.match(await p.locator('.channel-total').innerText(),/16,984.69/);assert.match(await p.locator('.channel-share').innerText(),/75.25%/);assert.match(await p.locator('.channel-share').innerText(),/24.75%/);assert.match(await p.locator('.channel-warning').innerText(),/6 order/);assert.match(await p.locator('.channel-cards article').first().innerText(),/204 order belum lengkap/);
 for(const label of ['1 hari','1 minggu','1 bulan','3 bulan','6 bulan','1 tahun','Keseluruhan']){await p.getByRole('button',{name:label,exact:true}).click();await p.locator('.channel-cards').waitFor();assert.equal(await p.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');}
 assert.equal(await p.getByLabel('Dari',{exact:true}).inputValue(),'');
 await p.getByRole('button',{name:'1 minggu',exact:true}).click();await p.locator('.channel-cards').waitFor();assert.equal((Date.parse(await p.getByLabel('Hingga').inputValue())-Date.parse(await p.getByLabel('Dari',{exact:true}).inputValue()))/86400000,6);
 await p.getByLabel('Metrik graf').selectOption('profit');const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/sales-channel-report.json'),'utf8'));assert.equal(await p.locator('.channel-trend g').count(),fixture.trend.filter(t=>t.profit!=null).length,'incomplete populated buckets have no false zero points');await p.getByLabel('Metrik graf').selectOption('orders');assert.equal(await p.locator('.channel-trend g').count(),60);
 await p.locator('.channel-cards article').first().getByRole('button',{name:'Semak pending',exact:true}).click();await p.locator('.channel-cards').waitFor();assert.equal(await p.getByLabel('Channel order').inputValue(),'deco');assert.equal(await p.getByLabel('Jenis order').inputValue(),'pending');await p.getByRole('button',{name:'QA-DECO-001',exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'QA-ORDER-001',exact:true}).count(),0);
 const event=p.waitForEvent('download');await p.getByRole('button',{name:'Eksport order CSV',exact:true}).click();const d=await event;await d.saveAs(path.join(out,'orders.csv'));const csv=fs.readFileSync(path.join(out,'orders.csv'),'utf8');assert(csv.includes('QA-DECO-001')&&!csv.includes('QA-ORDER-001'));
 await p.getByLabel('Channel order').selectOption('all');await p.locator('.channel-cards').waitFor();await p.getByLabel('Jenis order').selectOption('all');await p.locator('.channel-cards').waitFor();await p.getByRole('button',{name:'QA-ORDER-001',exact:true}).click();await p.getByRole('dialog').waitFor();await p.keyboard.press('Escape');
 await p.getByLabel('Cari order').fill('no-such-order');await p.getByText('Tiada order untuk filter ini.',{exact:true}).waitFor();await p.getByLabel('Cari order').fill('');await p.getByRole('button',{name:'QA-ORDER-001',exact:true}).waitFor();
 await p.evaluate(()=>document.querySelector('.content-area').scrollTop=0);assert.equal(await p.title(),'iCetak Finance QA');await p.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);await p.evaluate(()=>document.querySelector('.content-area').scrollTop=0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 await p.getByLabel('Dari',{exact:true}).fill('2000-01-01');await p.getByText('Tiada order untuk filter ini.',{exact:true}).waitFor();assert.match(await p.locator('.channel-total').innerText(),/0.00/);assert.equal(await p.getByRole('button',{name:'Tarikh sendiri',exact:true}).getAttribute('aria-pressed'),'true');
 await p.getByLabel('Hingga').fill('1999-12-31');await p.getByRole('alert').waitFor();assert.match(await p.getByRole('alert').innerText(),/Semak tarikh/);
 assert.deepEqual(errors,[]);console.log('PASS: rendered Admin desktop/mobile, all periods, percentage and missing-data labels, graph metrics/null gaps, filters/search/empty/invalid state, scoped CSV and order detail, no runtime/console errors');
}finally{await browser.close();await server.close()}
