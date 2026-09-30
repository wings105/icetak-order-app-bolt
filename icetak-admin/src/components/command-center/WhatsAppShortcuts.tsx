import { IconWhatsApp } from '../Icons';
import { phoneDigits } from './contracts';

export default function WhatsAppShortcuts({ phone, name }: { phone?: string | null; name: string }) {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return <span className="cc-wa-shortcuts">
    <a href={`whatsapp://send?phone=${digits}`} title={`WhatsApp app · ${digits}`} aria-label={`Buka WhatsApp app untuk ${name}`}><IconWhatsApp size={14} /></a>
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" title={`wa.me · ${digits}`} aria-label={`Buka WhatsApp web untuk ${name}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="15" rx="2"/><path d="M3 8h18M13 12h5v5M18 12l-6 6"/><circle cx="6" cy="6" r=".4" fill="currentColor" stroke="none"/></svg></a>
  </span>;
}
