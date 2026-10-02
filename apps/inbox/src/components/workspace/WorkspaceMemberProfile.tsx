import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, UserRound, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface WorkspaceMember {
  auth_user_id: string;
  display_name: string;
  role: string;
  avatar_url: string | null;
}

export function WorkspaceMemberProfile() {
  const [member, setMember] = useState<WorkspaceMember | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const ensured = await supabase.rpc('ensure_workspace_member');
      if (!active) return;
      if (ensured.error) {
        setError(ensured.error.message);
        setLoading(false);
        return;
      }
      const row = ensured.data as WorkspaceMember;
      setMember(row);
      setName(row.display_name);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (editing) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [editing]);

  async function save() {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!member || !clean || saving) return;
    setSaving(true);
    setError(null);
    const result = await supabase
      .from('workspace_members')
      .update({ display_name: clean, updated_at: new Date().toISOString() })
      .eq('auth_user_id', member.auth_user_id)
      .select('auth_user_id,display_name,role,avatar_url')
      .single();
    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }
    setMember(result.data as WorkspaceMember);
    setName(clean);
    setEditing(false);
    setSaving(false);
  }

  if (loading) return <div className="flex h-8 w-8 items-center justify-center text-[#8696a0]"><Loader2 size={14} className="animate-spin" /></div>;
  if (!member) return null;

  return (
    <div className="relative">
      <button
        onClick={() => { setEditing((value) => !value); setError(null); }}
        className={`flex max-w-[120px] items-center gap-1.5 rounded-full px-2 py-1.5 text-[10px] transition-colors ${
          member.display_name === 'Staff'
            ? 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'
            : 'bg-[#111b21] text-[#aebac1] hover:bg-[#2a3942] hover:text-white'
        }`}
        title="Nama ini digunakan dalam Activity Log"
      >
        <UserRound size={12} />
        <span className="truncate">{member.display_name === 'Staff' ? 'Set nama' : member.display_name}</span>
        <Pencil size={9} />
      </button>

      {editing && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-[#3b4a54] bg-[#202c33] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Profil Staff</p>
              <p className="text-[10px] capitalize text-[#8696a0]">Role: {member.role}</p>
            </div>
            <button onClick={() => { setEditing(false); setName(member.display_name); }} className="rounded p-1 text-[#8696a0] hover:bg-[#2a3942] hover:text-white"><X size={13} /></button>
          </div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#8696a0]">
            Nama dalam activity log
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
                if (event.key === 'Escape') { setEditing(false); setName(member.display_name); }
              }}
              maxLength={80}
              className="mt-1.5 w-full rounded-lg border border-[#3b4a54] bg-[#111b21] px-3 py-2 text-xs text-white outline-none focus:border-[#00a884]"
              placeholder="Contoh: Zaim, Mira, Ana"
            />
          </label>
          {error && <p className="mt-2 text-[10px] text-red-300">{error}</p>}
          <button
            onClick={() => void save()}
            disabled={!name.trim() || saving}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#00a884] py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? 'Menyimpan…' : 'Simpan Nama'}
          </button>
        </div>
      )}
    </div>
  );
}

