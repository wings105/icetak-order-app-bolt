const guards = new Map<string, { dirty: boolean; busy: boolean }>();
export function registerDesignDraft(id: string, dirty: boolean, busy: boolean) {
 guards.set(id, { dirty, busy });
 const unload = (e: BeforeUnloadEvent) => { if ([...guards.values()].some(g => g.dirty || g.busy)) { e.preventDefault(); e.returnValue = ''; } };
 window.addEventListener('beforeunload', unload);
 return () => { guards.delete(id); window.removeEventListener('beforeunload', unload); };
}
export function confirmDesignNavigation() {
 if ([...guards.values()].some(g => g.busy)) { window.alert('Tunggu tindakan ClickUp selesai sebelum menukar paparan.'); return false; }
 return ![...guards.values()].some(g => g.dirty) || window.confirm('Draft design belum dihantar. Keluar dan buang gambar/nota yang belum dihantar?');
}
