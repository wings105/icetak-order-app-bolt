import { useEffect, useRef } from 'react';

type MobileView = 'list' | 'chat';

interface MobileBackGuardProps {
  mobileView: MobileView;
  selectedId: string | null;
  onBackToList: () => void;
}

interface GuardState {
  icetakMobileGuard?: boolean;
  view?: MobileView;
  selectedId?: string | null;
}

export function MobileBackGuard({ mobileView, selectedId, onBackToList }: MobileBackGuardProps) {
  const onBackRef = useRef(onBackToList);
  useEffect(() => { onBackRef.current = onBackToList; }, [onBackToList]);

  useEffect(() => {
    if (mobileView !== 'chat' || !selectedId) return;

    const current = (window.history.state ?? {}) as GuardState;
    if (!current.icetakMobileGuard || current.view !== 'chat' || current.selectedId !== selectedId) {
      window.history.pushState(
        { ...current, icetakMobileGuard: true, view: 'chat', selectedId },
        '',
        `${window.location.pathname}${window.location.search}#chat=${encodeURIComponent(selectedId)}`,
      );
    }

    const handlePopState = () => {
      onBackRef.current();
      window.history.replaceState(
        { ...(window.history.state ?? {}), icetakMobileGuard: true, view: 'list', selectedId: null },
        '',
        `${window.location.pathname}${window.location.search}#inbox`,
      );
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView, selectedId]);

  return null;
}

