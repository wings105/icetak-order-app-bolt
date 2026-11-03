// Stable same-origin defaults using the owner's supplied courier artwork.
export function courierIconKey(value: unknown): 'pickup' | 'spx' | 'jnt' | 'ninjavan' | null {
  const key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('pickup') || key.includes('selfcollect')) return 'pickup';
  if (key.includes('spx') || key.includes('shopeeexpress')) return 'spx';
  if (key === 'jt' || key.includes('jnt') || key.includes('jtexpress')) return 'jnt';
  if (key.includes('ninja')) return 'ninjavan';
  return null;
}

export function renderCourierIcon(value: unknown): string {
  const icon = courierIconKey(value);
  if (!icon) return `<small>${String(value || 'Courier').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')}</small>`;
  const label = { pickup: 'Pickup', spx: 'SPX Express', jnt: 'J&T Express', ninjavan: 'Ninja Van' }[icon];
  return `<img class="cp-courier-icon" src="/images/couriers/${icon}.png" alt="${label}" width="80" height="30">`;
}
