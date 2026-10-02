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
    <div className="absolute bottom-full left-12 right-14 z-50 mb-2 rounded-xl border border-[#3b4a54] bg-[#111b21] p-3 text-xs text-[#8696a0] shadow-2xl">
      Tiada shortcut sepadan.
    </div>
  );

  return (
    <div className="absolute bottom-full left-12 right-14 z-50 mb-2 max-h-80 overflow-y-auto rounded-xl border border-[#3b4a54] bg-[#111b21] p-1.5 shadow-2xl">
      {matches.map((snippet, index) => (
        <button
          key={snippet.id}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(snippet)}
          className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ${index === activeIndex ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]'}`}
        >
          <MessageSquareText size={16} className="mt-0.5 flex-shrink-0 text-[#00a884]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-[#00a884]">/{snippet.shortcut}</span>
              <span className="truncate text-sm font-medium text-white">{snippet.title}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-[#aebac1]">{snippet.message}</p>
          </div>
        </button>
      ))}
      <div className="border-t border-[#2a3942] px-3 py-1.5 text-[10px] text-[#667781]">↑ ↓ pilih · Tab masukkan · Esc tutup</div>
    </div>
  );
}

