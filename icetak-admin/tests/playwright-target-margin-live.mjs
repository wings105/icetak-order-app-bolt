// Read-only rendering of a separately fetched live report; no auth bypass or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const file=process.env.TARGET_LIVE_REPORT;if(!file)throw new Error('TARGET_LIVE_REPORT must contain a read-only finance_contribution_report response');
const report=JSON.parse(fs.readFileSync(file,'utf8'));
const root=fileURLToPath(new URL('../',import.meta.url)),pw=await import(process.env.FINANCE_PLAYWRIGHT_MODULE||'playwright');
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:5177,strictPort:true}});await server.listen();
const browser=await pw.chromium.launch({headless:true,executablePath:process.env.FINANCE_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.addInitScript(r=>window.__targetLive=r,report);await p.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
try{
 await p.goto('http://127.0.0.1:5177/tests/order-profit.html?view=finance&finance_tab=target-margin');await p.locator('.ct-table tbody tr').first().waitFor();
 const currency=n=>new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(n);
 const metrics=await p.locator('.ct-metrics').innerText();for(const n of [report.summary.known,report.summary.remaining,report.summary.today,report.summary.daily_target])assert(metrics.includes(currency(n)));
 assert.equal(await p.locator('.ct-table tbody tr').count(),report.rows.length);assert.match(await p.locator('.ct-warning').first().innerText(),new RegExp(`${report.summary.missing} order`));
 for(const ch of report.channels){const card=p.locator('.ct-channel-grid article').filter({hasText:ch.channel==='shopee'?'Shopee':'Direct / Decoshop'});assert((await card.innerText()).includes(currency(ch.contribution)));}
 await p.screenshot({path:'/tmp/target-margin-qa/live-desktop.png',fullPage:true});await p.setViewportSize({width:390,height:844});await p.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:'/tmp/target-margin-qa/live-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,total:report.total,rendered:report.rows.length,known:report.summary.known,missing:report.summary.missing,verification:'real report values rendered in actual Admin App desktop/mobile; read only'}));
}finally{await browser.close();await server.close()}
