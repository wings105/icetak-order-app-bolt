from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing marker in {path}: {old[:120]!r}')
    if s.count(old) != 1:
        raise SystemExit(f'expected one marker in {path}, got {s.count(old)}')
    p.write_text(s.replace(old, new, 1))

# Orders V2: pickup auto settings, thumbnail lightbox, production lifecycle semantics.
p='icetak-admin/src/pages/Orders.tsx'
replace_once(p,
"type SavedView = { id: string; name: string; filters: Filters; sortKey: SortKey; sortDir: SortDir; visibleColumns: ColumnKey[]; isDefault?: boolean };\n",
"type SavedView = { id: string; name: string; filters: Filters; sortKey: SortKey; sortDir: SortDir; visibleColumns: ColumnKey[]; isDefault?: boolean };\n"+
"type PickupAutoSettings = { auto_send_enabled?: boolean; delay_minutes?: number; provider_name?: string; provider_ready?: boolean; template_name?: string; auto_send_activated_at?: string | null; pending?: number; sent?: number; failed?: number };\n")

replace_once(p,
"  const [detailLoading, setDetailLoading] = useState(false);\n  const can = (permission: string) => permissions.includes(permission);",
"  const [detailLoading, setDetailLoading] = useState(false);\n  const [pickupAuto, setPickupAuto] = useState<PickupAutoSettings | null>(null);\n  const [pickupAutoBusy, setPickupAutoBusy] = useState(false);\n  const [imagePreview, setImagePreview] = useState('');\n  const can = (permission: string) => permissions.includes(permission);")

replace_once(p,
"  const load = useCallback(async () => {",
"  const loadPickupAuto = useCallback(async () => {\n    const { data, error: rpcError } = await supabase.rpc('icetak_admin_pickup_auto_settings');\n    if (!rpcError) setPickupAuto((data || null) as PickupAutoSettings | null);\n  }, []);\n\n  const load = useCallback(async () => {")

replace_once(p,
"  useEffect(() => { void loadSavedViews(); }, [loadSavedViews]);\n",
"  useEffect(() => { void loadSavedViews(); }, [loadSavedViews]);\n  useEffect(() => { void loadPickupAuto(); }, [loadPickupAuto]);\n")

replace_once(p,
"  const copy = async (value: string, message: string) => {",
"  const togglePickupAuto = async () => {\n    if (!pickupAuto) return;\n    const next = !pickupAuto.auto_send_enabled;\n    const message = next\n      ? `Hidupkan Pickup Auto Send? Hanya order pickup yang menjadi Ready selepas switch ON akan dihantar ${pickupAuto.delay_minutes || 10} minit kemudian.`\n      : 'Matikan Pickup Auto Send? Semua pickup notification yang masih pending akan dibatalkan.';\n    if (!window.confirm(message)) return;\n    setPickupAutoBusy(true); setError(null);\n    const { data, error: rpcError } = await supabase.rpc('icetak_admin_set_pickup_auto_send', { p_enabled: next });\n    setPickupAutoBusy(false);\n    if (rpcError) { setError(rpcError.message); return; }\n    setPickupAuto((data || null) as PickupAutoSettings | null);\n    setNotice(`Pickup Auto Send ${next ? 'ON' : 'OFF'}.`);\n  };\n\n  const copy = async (value: string, message: string) => {")

replace_once(p,
"      <div className=\"erp-header-actions\"><button className=\"btn btn-outline\" onClick={() => void load()}>Refresh</button></div>",
"      <div className=\"erp-header-actions\">{pickupAuto && <div className={`erp-pickup-auto ${pickupAuto.auto_send_enabled ? 'on' : 'off'}`}><div><b>Pickup Auto {pickupAuto.auto_send_enabled ? 'ON' : 'OFF'}</b><span>{pickupAuto.delay_minutes || 10} min after ClickUp Complete · {pickupAuto.provider_ready ? 'Wasapflow Ready' : 'Provider Not Ready'}</span></div><button className={`btn btn-sm ${pickupAuto.auto_send_enabled ? 'btn-outline' : 'btn-primary'}`} disabled={pickupAutoBusy || (!pickupAuto.provider_ready && !pickupAuto.auto_send_enabled)} onClick={() => void togglePickupAuto()}>{pickupAutoBusy ? 'Saving…' : pickupAuto.auto_send_enabled ? 'Turn OFF' : 'Turn ON'}</button></div>}<button className=\"btn btn-outline\" onClick={() => { void load(); void loadPickupAuto(); }}>Refresh</button></div>")

replace_once(p,
"onWhatsapp={() => void toggleWhatsapp(order)} onCopy={copy} />)}",
"onWhatsapp={() => void toggleWhatsapp(order)} onCopy={copy} onPreview={(url) => setImagePreview(url)} />)}")

replace_once(p,
"    {(detailRef || detailLoading) && <OrderDrawer detail={detail} loading={detailLoading} permissions={permissions} busyId={busyId} onClose={closeDetail} onReload={async () => { await load(); if (detailRef) await loadDetail(detail?.order.dbId || detailRef); }} onAction={(o, name) => void action(o, name)} onWhatsapp={(o) => void toggleWhatsapp(o)} onCopy={copy} />}\n  </div>;",
"    {(detailRef || detailLoading) && <OrderDrawer detail={detail} loading={detailLoading} permissions={permissions} busyId={busyId} onClose={closeDetail} onReload={async () => { await load(); if (detailRef) await loadDetail(detail?.order.dbId || detailRef); }} onAction={(o, name) => void action(o, name)} onWhatsapp={(o) => void toggleWhatsapp(o)} onCopy={copy} />}\n    {imagePreview && <ImageLightbox url={imagePreview} onClose={() => setImagePreview('')} />}\n  </div>;")

replace_once(p,
"function OrderTableRow({ order, selected, visible, busy, can, menuOpen, onToggle, onOpen, onCustomer, onMenu, onAction, onWhatsapp, onCopy }: {\n  order: OrderRow; selected: boolean; visible: (key: ColumnKey) => boolean; busy: boolean; can: (p: string) => boolean; menuOpen: boolean;\n  onToggle: () => void; onOpen: () => void; onCustomer: () => void; onMenu: () => void; onAction: (name: string) => void; onWhatsapp: () => void; onCopy: (value: string, message: string) => Promise<void>;\n}) {",
"function OrderTableRow({ order, selected, visible, busy, can, menuOpen, onToggle, onOpen, onCustomer, onMenu, onAction, onWhatsapp, onCopy, onPreview }: {\n  order: OrderRow; selected: boolean; visible: (key: ColumnKey) => boolean; busy: boolean; can: (p: string) => boolean; menuOpen: boolean;\n  onToggle: () => void; onOpen: () => void; onCustomer: () => void; onMenu: () => void; onAction: (name: string) => void; onWhatsapp: () => void; onCopy: (value: string, message: string) => Promise<void>; onPreview: (url: string) => void;\n}) {")

replace_once(p,
"{visible('items') && <td><div className=\"erp-items-cell\">{order.thumbnailUrl && <a className=\"erp-order-thumb\" href={order.thumbnailUrl} target=\"_blank\" rel=\"noreferrer\" title=\"Open design image\"><img src={order.thumbnailUrl} alt=\"Order preview\" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></a>}<div className=\"erp-items-summary\"><b>{order.itemsCount || 0} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</b><span>{order.itemSummary || '—'}</span></div></div></td>}",
"{visible('items') && <td><div className=\"erp-items-cell\">{order.thumbnailUrl && <button type=\"button\" className=\"erp-order-thumb\" title=\"Preview design\" onClick={() => onPreview(order.thumbnailUrl || '')}><img src={order.thumbnailUrl} alt=\"Order preview\" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></button>}<div className=\"erp-items-summary\"><b>{order.itemsCount || 0} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</b><span>{order.itemSummary || '—'}</span></div></div></td>}")

replace_once(p,
"<b>{order.productionApproved ? 'Production approved' : 'Waiting approval'}</b>",
"<b>{productionLabel(order)}</b>")

old_next="""function nextAction(order: OrderRow, can: (p: string) => boolean): { label: string; action?: string; tone: 'primary' | 'outline'; disabled?: boolean } {
  const pickup = norm(order.delivery).includes('pickup');
  if (order.isCancelled || order.isCompleted) return { label: 'View Details', tone: 'outline' };
  if (order.awaitingCustomerConfirmation) return { label: 'Waiting Customer', tone: 'outline' };
  if (order.isProblem) return { label: 'Review Problem', tone: 'outline' };
  if (order.isUnpaid) {
    if (pickup && order.isCash && can('verify_payments')) return { label: 'Confirm Cash Paid', action: 'confirm_cash_paid', tone: 'primary' };
    return { label: 'View Payment', tone: 'outline' };
  }
  if (!order.productionApproved && can('approve_production')) return { label: 'Approve Production', action: 'approve_production', tone: 'primary' };
  if (pickup && order.productionApproved && !order.pickupReadyAt && can('approve_production')) return { label: 'Ready Pickup', action: 'ready_pickup', tone: 'primary' };
  if (pickup && order.pickupReadyAt && !order.pickupCollectedAt && can('approve_production')) return { label: 'Customer Collected', action: 'pickup_collected', tone: 'primary' };
  if (!pickup && order.trackingLink) return { label: 'View Tracking', tone: 'outline' };
  return { label: 'View Details', tone: 'outline' };
}
"""
new_next="""function shippingUnderway(order: OrderRow) {
  return ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order.shipmentStatusGroup)) || norm(order.fulfillmentStage) === 'in_transit';
}
function requiresProductionApproval(order: OrderRow) {
  return !order.productionApproved && norm(order.adminStatus).includes('ai_pending_confirmation');
}
function productionLabel(order: OrderRow) {
  if (order.productionCompletedAt || shippingUnderway(order) || Number(order.progressPercent || 0) >= 100) return 'Production complete';
  if (requiresProductionApproval(order)) return 'AI review pending';
  if (Number(order.componentsLinked || 0) > 0 || ['linked','queued','processing'].includes(norm(order.clickupSyncStatus))) return 'Production active';
  if (order.productionApproved) return 'Production approved';
  return 'Ready to process';
}
function nextAction(order: OrderRow, can: (p: string) => boolean): { label: string; action?: string; tone: 'primary' | 'outline'; disabled?: boolean } {
  const pickup = norm(order.delivery).includes('pickup');
  if (order.isCancelled || order.isCompleted) return { label: 'View Details', tone: 'outline' };
  if (order.awaitingCustomerConfirmation) return { label: 'Waiting Customer', tone: 'outline' };
  if (order.isProblem) return { label: 'Review Problem', tone: 'outline' };
  if (order.isUnpaid) {
    if (pickup && order.isCash && can('verify_payments')) return { label: 'Confirm Cash Paid', action: 'confirm_cash_paid', tone: 'primary' };
    return { label: 'View Payment', tone: 'outline' };
  }
  if (requiresProductionApproval(order) && can('approve_production')) return { label: 'Approve AI Order', action: 'approve_production', tone: 'primary' };
  if (pickup && order.pickupReadyAt && !order.pickupCollectedAt && can('approve_production')) return { label: 'Customer Collected', action: 'pickup_collected', tone: 'primary' };
  if (pickup && !order.pickupReadyAt) {
    if (Number(order.componentsTotal || 0) > 0) return { label: 'View Production', tone: 'outline' };
    if (order.productionApproved && can('approve_production')) return { label: 'Ready Pickup', action: 'ready_pickup', tone: 'primary' };
  }
  if (!pickup && (shippingUnderway(order) || order.trackingLink)) return { label: 'View Tracking', tone: 'outline' };
  return { label: 'View Details', tone: 'outline' };
}
"""
replace_once(p, old_next, new_next)

replace_once(p,
"<DrawerCard title=\"Production\"><KV k=\"Approved\" v={order.productionApproved ? 'Yes' : 'No'} />",
"<DrawerCard title=\"Production\"><KV k=\"State\" v={productionLabel(order)} />")
replace_once(p,
"{!order.isUnpaid && !order.productionApproved && canApprove && <button className=\"btn btn-primary btn-sm\" onClick={() => onAction(order, 'approve_production')}>Approve Production</button>}{norm(order.delivery).includes('pickup') && order.productionApproved && !order.pickupReadyAt && canApprove && <button className=\"btn btn-primary btn-sm\" onClick={() => onAction(order, 'ready_pickup')}>Ready Pickup</button>}",
"{!order.isUnpaid && requiresProductionApproval(order) && canApprove && <button className=\"btn btn-primary btn-sm\" onClick={() => onAction(order, 'approve_production')}>Approve AI Order</button>}{norm(order.delivery).includes('pickup') && order.productionApproved && !order.pickupReadyAt && Number(order.componentsTotal || 0) === 0 && canApprove && <button className=\"btn btn-primary btn-sm\" onClick={() => onAction(order, 'ready_pickup')}>Ready Pickup</button>}")

# Add image lightbox component before AdvancedFilters.
replace_once(p,
"function AdvancedFilters({ filters, onChange, onClear }:",
"function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {\n  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [onClose]);\n  return <div className=\"erp-image-lightbox\" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section><header><b>Design Preview</b><button type=\"button\" onClick={onClose}>×</button></header><div><img src={url} alt=\"Design preview\" /></div></section></div>;\n}\n\nfunction AdvancedFilters({ filters, onChange, onClear }:")

# Admin Orders styles for pickup toggle + modal + thumb button reset.
p='icetak-admin/src/pages/OrdersEnterprise.css'
with Path(p).open('a') as f:
    f.write("\n.erp-pickup-auto{display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid var(--border);border-radius:10px;background:#fff}.erp-pickup-auto>div{display:flex;flex-direction:column;gap:1px}.erp-pickup-auto b{font-size:11px}.erp-pickup-auto span{font-size:9.5px;color:var(--text-muted);white-space:nowrap}.erp-pickup-auto.on{border-color:#a7f3d0;background:#ecfdf5}.erp-order-thumb{border:0;padding:0;background:transparent;cursor:zoom-in}.erp-image-lightbox{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.72);display:grid;place-items:center;padding:18px}.erp-image-lightbox section{width:min(980px,96vw);height:min(820px,92vh);background:#fff;border-radius:16px;overflow:hidden;display:grid;grid-template-rows:auto 1fr;box-shadow:0 28px 90px rgba(0,0,0,.35)}.erp-image-lightbox header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border)}.erp-image-lightbox header button{width:36px;height:36px;border:0;border-radius:9px;background:#f1f5f9;font-size:22px;cursor:pointer}.erp-image-lightbox section>div{display:grid;place-items:center;overflow:auto;padding:14px;background:#f8fafc}.erp-image-lightbox img{max-width:100%;max-height:100%;object-fit:contain;background:#fff;border-radius:10px}@media(max-width:760px){.erp-pickup-auto{width:100%;justify-content:space-between}.erp-header-actions{flex-wrap:wrap}}\n")

# Customer portal: silent 15s live refresh so ClickUp complete appears as Ready Pickup without manual refresh.
p='src/customer-portal.ts'
replace_once(p,"let paymentPoll = 0;\nlet observerBusy = false;","let paymentPoll = 0;\nlet orderLivePoll = 0;\nlet observerBusy = false;")
replace_once(p,
"function selectedOrderToken() {\n  const queryToken = new URL(location.href).searchParams.get('order');\n  const stateToken = (history.state as { orderToken?: string } | null)?.orderToken;\n  return queryToken || stateToken || '';\n}\n",
"function selectedOrderToken() {\n  const queryToken = new URL(location.href).searchParams.get('order');\n  const stateToken = (history.state as { orderToken?: string } | null)?.orderToken;\n  return queryToken || stateToken || '';\n}\n\nfunction clearOrderLivePoll() {\n  if (orderLivePoll) window.clearInterval(orderLivePoll);\n  orderLivePoll = 0;\n}\nfunction startOrderLivePoll(token: string) {\n  clearOrderLivePoll();\n  if (!token) return;\n  orderLivePoll = window.setInterval(() => {\n    if (document.hidden || selectedOrderToken() !== token) return;\n    const main = document.querySelector<HTMLElement>('main.order-detail-page');\n    if (main) void loadFullOrder(main, token, true);\n  }, 15000);\n}\n")
replace_once(p,"async function loadFullHistory(main: HTMLElement) {\n  const token = customerToken();","async function loadFullHistory(main: HTMLElement) {\n  clearOrderLivePoll();\n  const token = customerToken();")
replace_once(p,"async function loadFullOrder(main: HTMLElement, token: string) {\n  if (!token) return;\n  const request = ++orderRequest;\n  renderOrderLoading(main);","async function loadFullOrder(main: HTMLElement, token: string, silent = false) {\n  if (!token) return;\n  const request = ++orderRequest;\n  if (!silent) renderOrderLoading(main);")
replace_once(p,"  if (main) void loadFullOrder(main, token);\n}","  if (main) { startOrderLivePoll(token); void loadFullOrder(main, token); }\n}")
replace_once(p,"    if (orderMain && orderMain.dataset.fullPortal !== '1' && token) void loadFullOrder(orderMain, token);","    if (orderMain && token) { startOrderLivePoll(token); if (orderMain.dataset.fullPortal !== '1') void loadFullOrder(orderMain, token); }")
replace_once(p,"window.addEventListener('popstate', () => {\n  clearPaymentPoll();","window.addEventListener('popstate', () => {\n  clearPaymentPoll();\n  clearOrderLivePoll();")

# whatsapp-send: pickup-specific double preflight.
p='supabase/functions/whatsapp-send/index.ts'
replace_once(p,
"async function windowStatus(phone: string) {",
"async function pickupAutoPreflight(body: Record<string, any>) {\n  const orderId = String(body.order_db_id || body?.vars?.order_db_id || '').trim();\n  if (!orderId) return { ok: false, error: 'pickup_order_id_required' };\n  const settings = await rest('pickup_notification_settings?singleton=eq.true&select=auto_send_enabled,provider_ready,auto_send_activated_at&limit=1').catch(() => []);\n  const config = settings?.[0];\n  if (!config?.auto_send_enabled) return { ok: false, error: 'pickup_auto_disabled' };\n  if (!config?.provider_ready) return { ok: false, error: 'pickup_provider_not_ready' };\n  const orders = await rest(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,delivery_method,delivery,pickup_ready_at,pickup_collected_at,status,admin_status,fulfillment_stage&limit=1`).catch(() => []);\n  const order = orders?.[0];\n  if (!order) return { ok: false, error: 'pickup_order_missing' };\n  if (!String(order.delivery_method || order.delivery || '').toLowerCase().includes('pickup')) return { ok: false, error: 'pickup_not_pickup' };\n  if (!order.pickup_ready_at) return { ok: false, error: 'pickup_order_not_ready' };\n  if (order.pickup_collected_at) return { ok: false, error: 'pickup_collected' };\n  const state = `${order.status || ''} ${order.admin_status || ''} ${order.fulfillment_stage || ''}`.toLowerCase();\n  if (state.includes('cancel')) return { ok: false, error: 'pickup_cancelled' };\n  if (config.auto_send_activated_at && new Date(order.pickup_ready_at).getTime() < new Date(config.auto_send_activated_at).getTime()) return { ok: false, error: 'pickup_historical_ready' };\n  return { ok: true };\n}\n\nasync function windowStatus(phone: string) {")
replace_once(p,
"    if (eventType === 'shipment_auto_tracking') {\n      const preflight = await trackingAutoPreflight(body);\n      if (preflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });\n      if (!preflight.ok) return json({ ok: false, error: preflight.error }, 409);\n    }\n\n    const rule =",
"    if (eventType === 'shipment_auto_tracking') {\n      const preflight = await trackingAutoPreflight(body);\n      if (preflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });\n      if (!preflight.ok) return json({ ok: false, error: preflight.error }, 409);\n    }\n    if (eventType === 'order_ready_pickup_auto') {\n      const preflight = await pickupAutoPreflight(body);\n      if (!preflight.ok) return json({ ok: false, error: preflight.error }, 409);\n    }\n\n    const rule =")
replace_once(p,
"    if (eventType === 'shipment_auto_tracking') {\n      const finalPreflight = await trackingAutoPreflight(body);\n      if (finalPreflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });\n      if (!finalPreflight.ok) return json({ ok: false, error: finalPreflight.error }, 409);\n    }\n\n    const baseLog =",
"    if (eventType === 'shipment_auto_tracking') {\n      const finalPreflight = await trackingAutoPreflight(body);\n      if (finalPreflight.duplicate) return json({ ok: true, duplicate: true, mode: 'auto', decision_reason: 'tracking_already_sent' });\n      if (!finalPreflight.ok) return json({ ok: false, error: finalPreflight.error }, 409);\n    }\n    if (eventType === 'order_ready_pickup_auto') {\n      const finalPreflight = await pickupAutoPreflight(body);\n      if (!finalPreflight.ok) return json({ ok: false, error: finalPreflight.error }, 409);\n    }\n\n    const baseLog =")

# Dispatcher: pickup safety stops are cancelled, never retried.
p='supabase/functions/whatsapp-dispatch/index.ts'
replace_once(p,
"const isTrackingSafetyStop = (message: string) => /tracking_(auto_disabled|cancelled|already_sent|not_sendable|state_missing|shipment_id_required)/i.test(message);",
"const isAutomationSafetyStop = (message: string) => /tracking_(auto_disabled|cancelled|already_sent|not_sendable|state_missing|shipment_id_required)|pickup_(auto_disabled|provider_not_ready|order_id_required|order_missing|not_pickup|order_not_ready|collected|cancelled|historical_ready)/i.test(message);")
replace_once(p,"        if (isTrackingSafetyStop(message)) {","        if (isAutomationSafetyStop(message)) {")
replace_once(p,"            last_error: message, decision_reason: 'tracking_safety_stop',","            last_error: message, decision_reason: 'automation_safety_stop',")

print('scoped patch complete')
