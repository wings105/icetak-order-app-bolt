import puppeteer from '@cloudflare/puppeteer';
import {getFields,normalizeConfig,validateConfig} from '../public/render-test/renderer.js';
import {resolveValues} from '../public/render-test/fields.js';

const API='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/render-template';
const STORAGE='https://buivecgahhmrhlmfujgt.supabase.co/storage/v1/object/public/render-templates/';
const ENGINE='4.0';
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
function fail(message,status=400){return Object.assign(new Error(message),{status});}
async function body(req){const text=await req.text();if(text.length>12000)throw fail('Request maksimum 12 KB',413);try{return JSON.parse(text);}catch{throw fail('JSON tidak sah');}}
async function gateway(req,payload){
 const r=await fetch(API,{method:'POST',headers:{authorization:req.headers.get('authorization')||'','content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok||!data.ok)throw fail(data.error||'Renderer backend unavailable',r.status);return data;
}
async function engineSource(env){
 const sources=await Promise.all(['fields.js','renderer.js'].map(async name=>{const r=await env.ASSETS.fetch('https://shop.decocake.my/render-test/'+name);if(!r.ok)throw fail('Renderer asset unavailable',503);const source=await r.text();if(source.length>60000||!source.includes(name==='fields.js'?'resolveValues':'prepareRender'))throw fail('Renderer asset invalid',503);return source.replace(/^import .*;\s*$/mg,'').replace(/\bexport (?=(?:async )?function|const|let)/g,'');}));
 return sources.join('\n')+'\nwindow.icetakRender={prepareRender};';
}
export async function renderPng(env,template,fields){
 let browser;
 try{
  const source=await engineSource(env);
  browser=await puppeteer.launch(env.BROWSER);
  const page=await browser.newPage();page.setDefaultTimeout(45000);
  const allowed=new Set([STORAGE+template.image_path,...template.config.layers.filter(l=>l.font_path).map(l=>STORAGE+l.font_path)]);
  await page.setRequestInterception(true);
  page.on('request',request=>{const operation=allowed.has(request.url())&&request.method()==='GET'?request.continue():request.abort();operation.catch(()=>{});});
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({content:source});
  const result=await page.evaluate(async ({template,fields})=>{
   const r=await window.icetakRender.prepareRender(template,fields);
   const data=r.canvas.toDataURL('image/png');
   return {base64:data.slice(data.indexOf(',')+1),width:r.canvas.width,height:r.canvas.height,layers:r.layers};
  },{template,fields});
  const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));
  if(bytes.length>16*1024*1024)throw fail('PNG terlalu besar',413);
  return {...result,bytes};
 }finally{if(browser)await browser.close().catch(()=>{});}
}
export default {
 async fetch(req,env,ctx){
  const url=new URL(req.url);
  if(url.pathname!=='/render-test/output.png'&&url.pathname!=='/render-test/automation')return env.ASSETS.fetch(req);
  try{
   if(url.pathname==='/render-test/automation'){
    if(req.method==='GET')return json({ok:true,engine:ENGINE,output:'/render-test/output.png',methods:['GET signed URL','POST Bearer + JSON'],browser_configured:!!env.BROWSER});
    if(req.method!=='POST')throw fail('Method not allowed',405);
    const b=await body(req);if(b.action!=='link')throw fail('Gunakan action link');
    const data=await gateway(req,{...b,action:'automation-link'});
    return json({ok:true,url:'https://shop.decocake.my/render-test/output.png?'+new URLSearchParams(data.query),expires:data.expires,fields:data.fields,version:data.version});
   }
   if(!['GET','POST'].includes(req.method))throw fail('Method not allowed',405);
   if(Number(req.headers.get('content-length')||0)>12000)throw fail('Request maksimum 12 KB',413);
   let input;
   if(req.method==='POST')input=await body(req);
   else{
    const params=url.searchParams;for(const key of new Set(params.keys()))if(params.getAll(key).length>1)throw fail('Parameter berulang: '+key);
    const fields=Object.fromEntries([...params].filter(([k])=>!['sku','version','expires','sig'].includes(k)));
    input={sku:params.get('sku'),fields,...(params.has('version')?{version:Number(params.get('version'))}:{}),expires:Number(params.get('expires')),sig:params.get('sig')};
   }
   const data=await gateway(req,{...input,action:'automation-template'});
   const template={...data.template,config:normalizeConfig(data.template.config,data.template.font_path)};validateConfig(template.config);
   const fields=resolveValues(template.config,input.fields,{required:true,strict:true});
   const fingerprint=JSON.stringify({engine:ENGINE,sku:template.sku,version:template.version,fields:getFields(template.config).map(f=>[f.key,fields[f.key]])});
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint)))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const cacheKey=new Request('https://shop.decocake.my/render-cache/'+hash);
   const cached=await caches.default.match(cacheKey);
   if(cached){const h=new Headers(cached.headers);h.set('cache-control','no-store');h.set('x-render-cache','HIT');return new Response(cached.body,{headers:h});}
   if(!env.BROWSER)throw fail('Browser rendering binding belum tersedia',503);
   const png=await renderPng(env,template,fields);
   const h={...headers,'content-type':'image/png','content-disposition':'inline; filename="'+template.sku.toLowerCase()+'-'+hash.slice(0,12)+'.png"','x-render-width':String(png.width),'x-render-height':String(png.height),'x-render-version':String(template.version),'x-render-id':hash,'x-render-cache':'MISS'};
   const response=new Response(png.bytes,{headers:h});
   const forCache=response.clone();forCache.headers.set('cache-control','public, max-age=3600');ctx.waitUntil(caches.default.put(cacheKey,forCache));
   return response;
  }catch(error){return json({ok:false,error:error.status?error.message:'Render gagal. Cuba semula.',engine:ENGINE},error.status||502);}
 }
};
