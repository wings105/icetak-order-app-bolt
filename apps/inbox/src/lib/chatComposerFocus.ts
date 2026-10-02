function isDesktopPointer(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

function composer(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Taip mesej"]');
}

function focusComposer(): void {
  if (!isDesktopPointer()) return;
  const field = composer();
  if (!field || field.disabled) return;
  field.focus({ preventScroll: true });
  const end = field.value.length;
  field.setSelectionRange(end, end);
}

export function installChatComposerFocus(): void {
  if (!isDesktopPointer()) return;

  let lastConversationField: HTMLTextAreaElement | null = null;
  let focusTimer: number | null = null;

  const scheduleFocus = (delay = 0) => {
    if (focusTimer !== null) window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      focusComposer();
      focusTimer = null;
    }, delay);
  };

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

    // Sending temporarily disables the textarea. Refocus once the request finishes.
    scheduleFocus(80);
    window.setTimeout(focusComposer, 350);
    window.setTimeout(focusComposer, 900);
  }, true);

  const observer = new MutationObserver(() => {
    const field = composer();
    if (!field) {
      lastConversationField = null;
      return;
    }

    // A newly mounted textarea means a chat was opened or switched.
    if (field !== lastConversationField) {
      lastConversationField = field;
      scheduleFocus(60);
      return;
    }

    // Sending sets disabled=true; when it becomes enabled, focus it again.
    if (!field.disabled && document.activeElement !== field) {
      scheduleFocus(40);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });

  window.addEventListener('focus', () => scheduleFocus(50));
}

