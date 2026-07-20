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
export const IconOrders = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
);
export const IconPayments = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
);
export const IconShipping = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
);
export const IconProducts = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
);
export const IconCustomers = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const IconReports = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
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
export const IconMenu = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 12h18M3 6h18M3 18h18" /></svg>
);
export const IconChevronLeft = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m15 18-6-6 6-6" /></svg>
);
export const IconChevronRight = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m9 18 6-6-6-6" /></svg>
);
export const IconPlus = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M12 5v14" /></svg>
);
export const IconDownload = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
);
export const IconFilter = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M22 3H2l8 9.46V19l4 2v-8.54Z" /></svg>
);
export const IconMore = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
);
export const IconArrowUp = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m18 15-6-6-6 6" /></svg>
);
export const IconArrowDown = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconDollar = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
);
export const IconBox = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
);
export const IconCart = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
);
export const IconUsers = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
);
export const IconTruck = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>
);
export const IconClock = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);
export const IconCheck = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconPackage = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
);
export const IconLogout = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
