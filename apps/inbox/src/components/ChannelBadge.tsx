import { Channel } from '../types';

interface ChannelBadgeProps {
  channel: Channel;
  size?: 'sm' | 'xs';
}

// Inline SVG icons — no external dependency
function WhatsAppIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function ShopeeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5a3.75 3.75 0 110 7.5 3.75 3.75 0 010-7.5zM6.5 10.5h11l1 9H5.5l1-9z"/>
    </svg>
  );
}

const CONFIG: Record<Channel, {
  label: string;
  bg: string;
  text: string;
  icon: React.ElementType<{ size: number }>;
}> = {
  whatsapp: {
    label: 'WhatsApp',
    bg: 'bg-[#d9fdd3] dark:bg-[var(--bubble-out)]/60',
    text: 'text-[#00a884]',
    icon: WhatsAppIcon,
  },
  shopee: {
    label: 'Shopee',
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    text: 'text-orange-600 dark:text-orange-400',
    icon: ShopeeIcon,
  },
};

export function ChannelBadge({ channel, size = 'sm' }: ChannelBadgeProps) {
  const cfg = CONFIG[channel];
  const Icon = cfg.icon;
  const iconSize = size === 'xs' ? 10 : 12;
  const textClass = size === 'xs' ? 'text-[10px]' : 'text-xs';
  const px = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium leading-tight ${cfg.bg} ${cfg.text} ${textClass} ${px}`}>
      <Icon size={iconSize} />
      {cfg.label}
    </span>
  );
}

