import {createRoot} from 'react-dom/client';
import AcrylicProduction,{type Snapshot} from './pages/AcrylicProduction';
import {configureTaskStation} from './lib/taskTransport';
import './index.css';
import './acrylic-production-display.css';

// Public snapshot reads remain anonymous. Actions reuse either the existing
// trusted-PC capability or the signed-in admin session through taskTransport.
const access=new URLSearchParams(window.location.hash.slice(1)).get('access')||'';
if(/^tw_[a-f0-9]{64}$/.test(access))configureTaskStation(access);
async function readDisplaySnapshot():Promise<Snapshot>{
 const env=import.meta.env;
 const base=env.VITE_SUPABASE_URL||env.SUPABASE_URL||'';
 if(!base)throw Error('Sambungan production belum tersedia.');
 const r=await fetch(`${base}/functions/v1/acrylic-production-display`,{method:'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data?.error||'Data production gagal dimuat.');return data as Snapshot;
}
document.title='iCetak — Acrylic Production';
createRoot(document.getElementById('production-root')!).render(<main className="acp-standalone"><AcrylicProduction readSnapshot={readDisplaySnapshot}/></main>);
