import { supabase } from './supabase';
import type { QuickSnippet } from './quickSnippets';

let snippets: QuickSnippet[] = [];
let popup: HTMLDivElement | null = null;
let activeIndex = 0;
let currentMatches: QuickSnippet[] = [];
let currentTextarea: HTMLTextAreaElement | null = null;

function isComposer(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement && target.placeholder.includes('Taip mesej');
}

async function loadSnippets() {
  const { data } = await supabase.from('quick_snippets')
    .select('id,shortcut,title,message,category,active,sort_order,image_path,image_name,image_mime')
    .eq('active', true)
    .order('sort_order')
    .order('shortcut');
  snippets = (data ?? []) as QuickSnippet[];
}

function closePopup() {
  popup?.remove();
  popup = null;
  currentMatches = [];
  activeIndex = 0;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(value.length, value.length);
}

function getContext() {
  try {
    return JSON.parse(window.sessionStorage.getItem('icetak-snippet-context') || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function replaceVariables(message: string) {
  const context = getContext();
  const today = new Intl.DateTimeFormat('ms-MY', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const values: Record<string, string> = {
    name: context.name || '',
    phone: context.phone || '',
    order_id: context.order_id || '',
    today,
  };
  return message.replace(/\{\{\s*(name|phone|order_id|today)\s*\}\}/gi, (_, key: string) => values[key.toLowerCase()] ?? '');
}

async function queueSnippetImage(snippet: QuickSnippet) {
  if (!snippet.image_path) return;
  const { data, error } = await supabase.storage.from('snippet-media').download(snippet.image_path);
  if (error || !data) throw error ?? new Error('Gagal mengambil gambar snippet.');
  const file = new File([data], snippet.image_name || 'snippet-image.jpg', { type: snippet.image_mime || data.type || 'image/jpeg' });
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
  if (!input) throw new Error('Input gambar tidak dijumpai.');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function selectSnippet(snippet: QuickSnippet) {
  if (!currentTextarea) return;
  const value = currentTextarea.value;
  const match = value.match(/(^|\s)\/[^\s]*$/);
  const prefix = match ? value.slice(0, match.index! + match[1].length) : value;
  const message = replaceVariables(snippet.message || '');
  setTextareaValue(currentTextarea, `${prefix}${message}`);
  closePopup();
  if (snippet.image_path) {
    try {
      await queueSnippetImage(snippet);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Gagal masukkan gambar snippet.');
    }
  }
}

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPopup(textarea: HTMLTextAreaElement, query: string) {
  currentTextarea = textarea;
  const normalized = query.toLowerCase();
  currentMatches = snippets
    .filter((snippet) => !normalized || snippet.shortcut.toLowerCase().includes(normalized) || snippet.title.toLowerCase().includes(normalized) || (snippet.category || '').toLowerCase().includes(normalized))
    .slice(0, 10);
  activeIndex = Math.min(activeIndex, Math.max(0, currentMatches.length - 1));

  if (!popup) {
    popup = document.createElement('div');
    popup.style.position = 'fixed';
    popup.style.zIndex = '9999';
    popup.style.maxHeight = '340px';
    popup.style.overflowY = 'auto';
    popup.style.background = '#111b21';
    popup.style.border = '1px solid #3b4a54';
    popup.style.borderRadius = '12px';
    popup.style.boxShadow = '0 14px 40px rgba(0,0,0,.45)';
    popup.style.padding = '6px';
    document.body.appendChild(popup);
  }

  const rect = textarea.getBoundingClientRect();
  popup.style.left = `${Math.max(8, rect.left)}px`;
  popup.style.width = `${Math.max(280, rect.width)}px`;
  popup.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;

  if (!currentMatches.length) {
    popup.innerHTML = '<div style="padding:10px;color:#8696a0;font-size:12px">Tiada shortcut sepadan.</div>';
    return;
  }

  popup.innerHTML = '';
  currentMatches.forEach((snippet, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.display = 'block';
    button.style.width = '100%';
    button.style.textAlign = 'left';
    button.style.border = '0';
    button.style.borderRadius = '8px';
    button.style.padding = '9px 10px';
    button.style.background = index === activeIndex ? '#2a3942' : 'transparent';
    button.style.color = '#e9edef';
    button.style.cursor = 'pointer';
    const imageBadge = snippet.image_path ? '<span style="font-size:10px;color:#53bdeb;border:1px solid #3b4a54;border-radius:999px;padding:1px 6px">gambar</span>' : '';
    const categoryBadge = snippet.category ? `<span style="font-size:10px;color:#aebac1">${esc(snippet.category)}</span>` : '';
    button.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><strong style="color:#00a884;font-family:monospace">/${esc(snippet.shortcut)}</strong><span style="font-size:13px;font-weight:600">${esc(snippet.title)}</span>${imageBadge}${categoryBadge}</div><div style="font-size:12px;color:#aebac1;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(snippet.message || '[Gambar sahaja]')}</div>`;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => void selectSnippet(snippet));
    popup!.appendChild(button);
  });
}

function handleInput(event: Event) {
  if (!isComposer(event.target)) return;
  const textarea = event.target;
  const match = textarea.value.match(/(^|\s)\/([^\s]*)$/);
  if (!match) {
    closePopup();
    return;
  }
  renderPopup(textarea, match[2]);
}

function handleKeydown(event: KeyboardEvent) {
  if (!isComposer(event.target) || !popup) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex = (activeIndex + 1) % Math.max(1, currentMatches.length);
    renderPopup(event.target, event.target.value.match(/(^|\s)\/([^\s]*)$/)?.[2] ?? '');
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex = (activeIndex - 1 + Math.max(1, currentMatches.length)) % Math.max(1, currentMatches.length);
    renderPopup(event.target, event.target.value.match(/(^|\s)\/([^\s]*)$/)?.[2] ?? '');
  } else if ((event.key === 'Tab' || event.key === 'Enter') && currentMatches[activeIndex]) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void selectSnippet(currentMatches[activeIndex]);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePopup();
  }
}

function attachQuickButton() {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Taip mesej"]');
  if (!textarea || textarea.parentElement?.querySelector('[data-quick-snippet-button]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.quickSnippetButton = 'true';
  button.title = 'Quick replies';
  button.textContent = '⚡';
  button.style.width = '36px';
  button.style.height = '36px';
  button.style.flexShrink = '0';
  button.style.borderRadius = '999px';
  button.style.border = '0';
  button.style.background = 'transparent';
  button.style.color = '#f5b942';
  button.style.fontSize = '18px';
  button.style.cursor = 'pointer';
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    currentTextarea = textarea;
    renderPopup(textarea, '');
    textarea.focus({ preventScroll: true });
  });
  textarea.parentElement?.insertBefore(button, textarea);
}

export function installSlashSnippetEnhancer() {
  void loadSnippets();
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', (event) => {
    if (popup && event.target !== currentTextarea && !popup.contains(event.target as Node) && !(event.target as HTMLElement)?.closest?.('[data-quick-snippet-button]')) closePopup();
  }, true);

  const observer = new MutationObserver(attachQuickButton);
  observer.observe(document.body, { childList: true, subtree: true });
  attachQuickButton();

  supabase.channel('slash-snippets-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_snippets' }, () => void loadSnippets())
    .subscribe();
}

