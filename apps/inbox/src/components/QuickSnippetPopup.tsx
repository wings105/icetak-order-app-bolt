import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import type { QuickSnippet } from '../lib/quickSnippets';

interface Props {
  snippets: QuickSnippet[];
  query: string;
  onSelect: (snippet: QuickSnippet) => void;
  onClose: () => void;
}

export function QuickSnippetPopup({ snippets, query, onSelect, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const normalized = query.toLowerCase().replace(/^\//, '');
  const matches = useMemo(() => snippets
    .filter((snippet) => snippet.active)
    .filter((snippet) => !normalized || snippet.shortcut.toLowerCase().includes(normalized) || snippet.title.toLowerCase().includes(normalized))
    .slice(0, 8), [snippets, normalized]);

  useEffect(() => { setActiveIndex(0); }, [normalized]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!matches.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % matches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        onSelect(matches[activeIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, activeIndex, onSelect, onClose]);

  if (!matches.length) return (
    <div className="absolute bottom-full left-12 right-14 z-50 mb-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-secondary)] shadow-2xl">
      Tiada shortcut sepadan.
    </div>
  );

  return (
    <div className="absolute bottom-full left-12 right-14 z-50 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-2xl">
      {matches.map((snippet, index) => (
        <button
          key={snippet.id}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(snippet)}
          className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ${index === activeIndex ? 'bg-[var(--surface-hover)]' : 'hover:bg-[var(--surface-muted)]'}`}
        >
          <MessageSquareText size={16} className="mt-0.5 flex-shrink-0 text-[#00a884]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-[#00a884]">/{snippet.shortcut}</span>
              <span className="truncate text-sm font-medium text-[var(--text)]">{snippet.title}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{snippet.message}</p>
          </div>
        </button>
      ))}
      <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]">↑ ↓ pilih · Tab masukkan · Esc tutup</div>
    </div>
  );
}
