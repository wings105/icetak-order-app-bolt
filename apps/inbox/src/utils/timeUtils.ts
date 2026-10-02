import { WindowStatus } from '../types';

const TZ = 'Asia/Kuala_Lumpur';

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('ms-MY', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatConversationTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const todayStr = now.toLocaleDateString('ms-MY', { timeZone: TZ });
  const dateStr = date.toLocaleDateString('ms-MY', { timeZone: TZ });

  if (todayStr === dateStr) {
    return formatTime(date);
  }

  if (diffDays === 1) return 'Semalam';
  if (diffDays < 7) {
    return date.toLocaleDateString('ms-MY', {
      timeZone: TZ,
      weekday: 'short',
    });
  }
  return date.toLocaleDateString('ms-MY', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export function formatFullDate(date: Date): string {
  return date.toLocaleString('ms-MY', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getWindowStatus(lastInboundAt: Date | undefined): WindowStatus {
  if (!lastInboundAt) return 'no_window';
  const diffMs = Date.now() - lastInboundAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours >= 24) return 'expired';
  if (diffHours >= 22) return 'closing_soon';
  return 'open';
}

export function getWindowRemaining(lastInboundAt: Date | undefined): string {
  if (!lastInboundAt) return '';
  const diffMs = Date.now() - lastInboundAt.getTime();
  const remainingMs = 24 * 60 * 60 * 1000 - diffMs;
  if (remainingMs <= 0) return 'Tamat';
  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.toLocaleDateString('ms-MY', { timeZone: TZ }) ===
    b.toLocaleDateString('ms-MY', { timeZone: TZ })
  );
}

export function formatDaySeparator(date: Date): string {
  const now = new Date();
  const todayStr = now.toLocaleDateString('ms-MY', { timeZone: TZ });
  const dateStr = date.toLocaleDateString('ms-MY', { timeZone: TZ });
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (todayStr === dateStr) return 'Hari Ini';
  if (diffDays === 1) return 'Semalam';
  return date.toLocaleDateString('ms-MY', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

