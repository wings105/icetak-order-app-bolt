import { useEffect, useState } from 'react';

/** Refresh read-time deadlines while the app stays open and when staff return to the tab. */
export function useOrderClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setNow(Date.now()); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return now;
}
