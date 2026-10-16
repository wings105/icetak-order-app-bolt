import {createRoot} from 'react-dom/client';
import AcrylicProduction,{type Snapshot} from './pages/AcrylicProduction';
import './index.css';
import './acrylic-production-display.css';

// This standalone read has no session, admin client, cookies or dashboard bootstrap.
async function readDisplaySnapshot():Promise<Snapshot>{
 const env=import.meta.env;
 const base=env.VITE_SUPABASE_URL||env.SUPABASE_URL||'';
 if(!base)throw Error('Sambungan production belum tersedia.');
 const r=await fetch(`${base}/functions/v1/acrylic-production-display`,{method:'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data?.error||'Data production gagal dimuat.');return data as Snapshot;
}
document.title='iCetak — Acrylic Production';
createRoot(document.getElementById('production-root')!).render(<main className="acp-standalone"><AcrylicProduction readSnapshot={readDisplaySnapshot}/></main>);
