// Stable root OAuth discovery/gateway. No credentials, database keys or customer data stored here.
const UPSTREAM = 'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/icetak-mcp';
export default {
 async fetch(request) {
  const incoming = new URL(request.url);
  if(incoming.hostname !== 'icetak-mcp.msg-ebye.workers.dev')return new Response('Unknown host',{status:421});
  if(!['GET','POST','OPTIONS','DELETE'].includes(request.method))return new Response('Method not allowed',{status:405});
  const target = new URL(UPSTREAM+incoming.pathname); target.search=incoming.search;
  const headers=new Headers(request.headers);headers.delete('host');headers.delete('x-mcp-dispatch');
  const response=await fetch(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',signal:AbortSignal.timeout(55000)});
  const out=new Headers(response.headers);out.set('Cache-Control','no-store');out.set('X-Content-Type-Options','nosniff');
  // Supabase's default domain rewrites HTML to text/plain + sandbox.
  // Restore only our own generated, escaped GET consent form on the stable issuer.
  if(incoming.pathname==='/authorize'&&request.method==='GET'&&response.status===200){
   out.set('Content-Type','text/html; charset=utf-8');
   out.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com https://chat.openai.com; frame-ancestors 'none'; base-uri 'none'");
   out.set('Referrer-Policy','no-referrer');
  }
  return new Response(response.body,{status:response.status,headers:out});
 }
};
