import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconDashboard = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
);
export const IconTower = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></svg>
);
export const IconOrders = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
);
export const IconPayments = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
);
export const IconShipping = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const IconWhatsApp = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" /></svg>
);
export const IconIntegration = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M12 2a4 4 0 0 1 4 4v2h2a2 2 0 0 1 2 2v2a4 4 0 0 1-4 4h-2v2a4 4 0 0 1-8 0v-2H4a2 2 0 0 1-2-2v-2a4 4 0 0 1 4-4h2V6a4 4 0 0 1 4-4Z" /></svg>
);
export const IconStaff = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const IconSettings = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconSearch = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
export const IconBell = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const IconRefresh = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></svg>
);
export const IconMenu = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 12h18M3 6h18M3 18h18" /></svg>
);
export const IconChevronRight = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m9 18 6-6-6-6" /></svg>
);
export const IconPlus = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M12 5v14" /></svg>
);
export const IconDownload = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
);
export const IconMore = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
);
export const IconEye = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconEdit = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" /></svg>
);
export const IconCheck = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconX = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconMessage = ({ size = 12, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
);
export const IconCalendar = ({ size = 12, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
);
export const IconPhone = ({ size = 12, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
);
export const IconLogout = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const IconTrend = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
);
export const IconBox = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
);
export const IconAlert = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
export const IconWifi = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></svg>
);
export const IconPower = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
);
export const IconCode = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
);
