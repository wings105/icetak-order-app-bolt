import { useState } from 'react';
import { supabase } from './lib/supabase';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';

type Props = { onAuthenticated: () => void };

export default function AdminLogin({ onAuthenticated }: Props) {
  const resetMode = new URLSearchParams(window.location.search).get('admin-reset') === '1';
  const [mode, setMode] = useState<'login'|'setup'|'reset'>(resetMode ? 'reset' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const login = async (form: FormData) => {
    setBusy(true); setError(null);
    const email=String(form.get('email')||'').trim().toLowerCase();
    const password=String(form.get('password')||'');
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if(authError||!data.session) return setError(authError?.message||'Login gagal');
    sessionStorage.setItem('admin_access_token',data.session.access_token);
    sessionStorage.setItem('admin_refresh_token',data.session.refresh_token||'');
    sessionStorage.setItem('admin_session',data.session.access_token);
    onAuthenticated();
  };

  const setup = async (form: FormData) => {
    setBusy(true); setError(null);
    const email=String(form.get('email')||'').trim().toLowerCase();
    const password=String(form.get('password')||'');
    const displayName=String(form.get('display_name')||'Owner').trim();
    const bootstrapKey=String(form.get('bootstrap_key')||'');
    try {
      const {data,error:signError}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}${location.pathname}?admin=v2`}});
      if(signError) throw signError;
      if(!data.session){ setNotice('Semak email untuk sahkan akaun. Selepas itu buka Admin V2 dan login.'); return; }
      const response=await fetch(`${supabaseUrl}/functions/v1/admin-link`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${data.session.access_token}`,'x-bootstrap-key':bootstrapKey},body:JSON.stringify({display_name:displayName})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.ok===false) throw new Error(result.error||'Admin setup gagal');
      sessionStorage.setItem('admin_access_token',data.session.access_token); sessionStorage.setItem('admin_session',data.session.access_token); onAuthenticated();
    } catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };

  const forgot = async () => {
    const email=window.prompt('Masukkan email admin:')?.trim().toLowerCase(); if(!email)return;
    const {error:resetError}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}${location.pathname}?admin=v2&admin-reset=1`});
    if(resetError)setError(resetError.message);else setNotice('Jika email wujud, link reset password telah dihantar.');
  };

  const reset = async (form:FormData) => {
    const password=String(form.get('password')||''); const confirm=String(form.get('confirm')||'');
    if(password!==confirm)return setError('Password confirmation tidak sama.');
    setBusy(true); const {error:resetError}=await supabase.auth.updateUser({password}); setBusy(false);
    if(resetError)return setError(resetError.message);
    await supabase.auth.signOut();
    const url=new URL(location.href); url.searchParams.delete('admin-reset'); history.replaceState({},'',url); setMode('login'); setNotice('Password berjaya ditukar. Sila login semula.');
  };

  return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f4f6fb',padding:20}}><section className="panel" style={{width:'min(460px,100%)',padding:24}}><div style={{marginBottom:20}}><div className="page-label">iCetak ERP</div><h1 style={{margin:'5px 0 6px'}}>Admin V2</h1><p className="cell-sub">Secure admin login via Supabase Auth</p></div>{notice&&<div style={{padding:10,borderRadius:10,background:'#ecfdf3',color:'#067647',marginBottom:12}}>{notice}</div>}{error&&<div style={{padding:10,borderRadius:10,background:'#fef3f2',color:'#b42318',marginBottom:12}}>{error}</div>}{mode==='login'&&<form onSubmit={(e)=>{e.preventDefault();void login(new FormData(e.currentTarget));}} style={{display:'grid',gap:12}}><Field label="Email"><input name="email" type="email" required autoComplete="email"/></Field><Field label="Password"><input name="password" type="password" required autoComplete="current-password"/></Field><button className="btn btn-primary" disabled={busy}>{busy?'Signing in...':'Login Admin'}</button><button className="btn btn-outline" type="button" onClick={()=>void forgot()}>Forgot Password</button><button className="btn btn-outline" type="button" onClick={()=>setMode('setup')}>First Admin Setup</button></form>}{mode==='setup'&&<form onSubmit={(e)=>{e.preventDefault();void setup(new FormData(e.currentTarget));}} style={{display:'grid',gap:12}}><Field label="Display Name"><input name="display_name" defaultValue="Owner" required/></Field><Field label="Email"><input name="email" type="email" required/></Field><Field label="New Password"><input name="password" type="password" minLength={10} required/></Field><Field label="Bootstrap Key"><input name="bootstrap_key" type="password" required/></Field><button className="btn btn-primary" disabled={busy}>{busy?'Creating...':'Create Secure Admin'}</button><button className="btn btn-outline" type="button" onClick={()=>setMode('login')}>Back to Login</button></form>}{mode==='reset'&&<form onSubmit={(e)=>{e.preventDefault();void reset(new FormData(e.currentTarget));}} style={{display:'grid',gap:12}}><Field label="New Password"><input name="password" type="password" minLength={10} required/></Field><Field label="Confirm Password"><input name="confirm" type="password" minLength={10} required/></Field><button className="btn btn-primary" disabled={busy}>{busy?'Updating...':'Update Password'}</button></form>}</section></main>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="form-field"><span>{label}</span>{children}</label>;}
