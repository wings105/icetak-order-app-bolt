import { IconShipping } from '../Icons';

export default function DeliveryIcon({ method }: { method?: string | null }) {
  const value = (method || '').trim().toLowerCase();
  const pickup = ['pickup', 'pick_up', 'self_pickup', 'self pickup', 'walkin', 'walk-in'].includes(value);
  const post = ['spx', 'jnt', 'j&t', 'j&t express', 'ninja', 'ninjavan', 'ninja van', 'courier', 'post', 'postage', 'pos', 'poslaju', 'pos laju', 'shipping', 'delivery'].includes(value);
  if (!pickup && !post) return null;
  return <span className={`cc-delivery-icon ${pickup ? 'pickup' : 'post'}`} role="img" aria-label={pickup ? 'Pickup' : 'Pos / courier'} title={pickup ? 'Pickup · ambil di kedai' : 'Pos / courier'}>
    {pickup ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10l2-6h14l2 6M4 10v10h16V10M3 10h18M9 20v-6h6v6"/><path d="M7 10v2M12 10v2M17 10v2"/></svg> : <IconShipping size={14} aria-hidden="true"/>}
  </span>;
}
