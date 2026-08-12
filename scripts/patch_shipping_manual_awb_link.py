from pathlib import Path
# temporary scoped patch; removed after successful build
p=Path('icetak-admin/src/pages/Shipping.tsx')
s=p.read_text()

s=s.replace("type TrackingAction = 'opened' | 'sent' | 'reopen' | 'cancel' | 'restore' | 'retry_auto';\n", "type TrackingAction = 'opened' | 'sent' | 'reopen' | 'cancel' | 'restore' | 'retry_auto';\n\ntype MatchCandidate = { orderDbId?: string; orderNo?: string; status?: string; adminStatus?: string; delivery?: string; courier?: string; createdAt?: string };\ntype MatchSuggestion = { candidateCount?: number; autoLinkable?: boolean; reason?: string; orderDbId?: string; orderNo?: string; confidence?: number; candidates?: MatchCandidate[] };\n")

s=s.replace("  message_body: string;\n};", "  message_body: string;\n  match_suggestion?: MatchSuggestion | null;\n};")

marker="  const toggleAutoSend = async () => {\n"
insert="""  const linkShipmentOrder = async (row: TrackingRow, suggestedRef?: string) => {\n    const suggestion = row.match_suggestion;\n    const initial = suggestedRef || suggestion?.orderNo || '';\n    const orderRef = suggestedRef || window.prompt(\n      suggestion?.orderNo\n        ? `Link tracking ${row.tracking_no} ke order iCetak?\\n\\nSuggested: ${suggestion.orderNo} (${suggestion.confidence || 0}% match)\\nBoleh ubah Order ID jika perlu.`\n        : `Masukkan Order ID iCetak untuk tracking ${row.tracking_no}.\\nContoh: IC260810-7539`,\n      initial,\n    );\n    if (!orderRef?.trim()) return;\n    const confirmed = window.confirm(`Link ${row.tracking_no} → ${orderRef.trim()}?\\n\\nStatus shipment semasa akan sync ke order tersebut.`);\n    if (!confirmed) return;\n    setBusyId(row.id);\n    setError(null);\n    const { data, error: linkError } = await supabase.rpc('icetak_admin_link_shipment_order', {\n      p_shipment_id: row.id,\n      p_order_ref: orderRef.trim(),\n    });\n    if (linkError) setError(linkError.message);\n    else {\n      const linked = (data || {}) as { orderNo?: string };\n      setNotice(`Tracking linked ke ${linked.orderNo || orderRef.trim()}.`);\n      await load(true);\n    }\n    setBusyId(null);\n  };\n\n""" + marker
if marker not in s: raise SystemExit('toggle marker not found')
s=s.replace(marker,insert,1)

customer_marker="""                        {row.order_id && row.order_no && (\n                          <div style={{ marginTop: 3 }}>\n                            <a href={`/?admin=v2&order=${encodeURIComponent(row.order_no)}`} target=\"_blank\" rel=\"noreferrer\" className=\"cell-sub\" title=\"Open linked iCetak order\" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>\n                              Order {row.order_no}\n                            </a>\n                          </div>\n                        )}\n"""
customer_repl=customer_marker+"""                        {!row.order_id && row.match_suggestion?.orderNo && (\n                          <div style={{ marginTop: 4 }}>\n                            <span className={`badge ${row.match_suggestion.autoLinkable ? 'badge-success' : 'badge-warning'}`}>\n                              Suggested {row.match_suggestion.orderNo} · {row.match_suggestion.confidence || 0}%\n                            </span>\n                            <div className=\"cell-sub\" style={{ marginTop: 3 }}>\n                              {row.match_suggestion.reason === 'phone_unique_courier_mismatch' ? 'Phone exact · courier perlu semak' : 'Phone + courier match'}\n                            </div>\n                          </div>\n                        )}\n"""
if customer_marker not in s: raise SystemExit('customer marker not found')
s=s.replace(customer_marker,customer_repl,1)

action_marker="""                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 230 }}>\n                          {cancelled ? (\n"""
action_repl="""                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 230 }}>\n                          {!row.order_id && row.match_suggestion?.orderNo && (\n                            <button className={row.match_suggestion.autoLinkable ? 'btn btn-primary' : 'btn btn-outline'} disabled={busy} onClick={() => void linkShipmentOrder(row, row.match_suggestion?.orderNo || undefined)}>\n                              Link {row.match_suggestion.orderNo}\n                            </button>\n                          )}\n                          {!row.order_id && (\n                            <button className=\"btn btn-outline\" disabled={busy} onClick={() => void linkShipmentOrder(row)}>Link Order</button>\n                          )}\n                          {cancelled ? (\n"""
if action_marker not in s: raise SystemExit('action marker not found')
s=s.replace(action_marker,action_repl,1)

p.write_text(s)
