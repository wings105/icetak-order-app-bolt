export function safeActionWebhookUrl(value:unknown):string {
 const raw=String(value||'').trim();if(!raw)return '';
 if(raw.length>2048)throw new Error('Webhook URL terlalu panjang.');
 let url:URL;try{url=new URL(raw);}catch{throw new Error('Webhook URL tidak sah.');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hash||!host.includes('.')||host.startsWith('[')||/^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))throw new Error('Gunakan URL webhook HTTPS dengan domain awam, tanpa login atau port khas.');
 url.hostname=host;return url.href;
}
