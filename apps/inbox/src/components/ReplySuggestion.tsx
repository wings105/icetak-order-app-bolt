import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Conversation } from '../types';
import { useReplySuggestion } from '../lib/useReplySuggestion';

export function ReplySuggestion({ conversation, ready, onPick }: { conversation: Conversation; ready: boolean; onPick: (text: string) => void }) {
  const { result, loading, error, refresh, canRefresh } = useReplySuggestion(conversation, ready);
  if (!ready || !conversation.messages.some(m => m.direction === 'inbound')) return null;
  const note = result?.order_reference ? `Order ${result.order_reference}` : 'Semak detail sebelum hantar';
  return (
    <div className="mx-4 mt-2 mb-0 min-w-0 border-l-2 border-[#00a884]/50 pl-3" data-reply-suggestion>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        <span className="flex-1" role="status">{loading ? 'Semak chat & order…' : error || 'Cadangan balasan'}{result?.text && !loading ? ' · klik untuk guna' : ''}</span>
        <button type="button" onClick={refresh} disabled={!canRefresh} aria-label="Semak semula cadangan" title={canRefresh ? 'Semak semula chat dan status order' : 'Tunggu sebelum semak semula'} className="rounded p-1.5 hover:bg-[var(--surface-hover)] disabled:opacity-40"><RefreshCw size={12} /></button>
      </div>
      {result?.text && !loading && (
        <>
          <button type="button" onClick={() => { if (Date.parse(result.expires_at) > Date.now()) onPick(result.text); else refresh(); }} title={result.warnings.join('\n')} className="block w-full max-h-28 overflow-y-auto rounded py-1.5 pr-2 text-left text-[13px] leading-5 text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00a884] whitespace-pre-wrap break-words" aria-label={`Guna cadangan: ${result.text}`}>{result.text}</button>
          <div className="pb-1 text-[10px] text-[var(--text-secondary)]">{note} · SOP</div>
        </>
      )}
      {result && !result.text && !loading && <p className="pb-1 text-xs text-[var(--text-secondary)]">Belum cukup konteks untuk cadangan. Baca mesej pelanggan dahulu.</p>}
    </div>
  );
}
