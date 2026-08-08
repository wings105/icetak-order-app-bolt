from pathlib import Path

path = Path('icetak-admin/src/pages/Orders.tsx')
text = path.read_text()

import_line = "import OrderItemStructuralEditor from '../components/OrderItemStructuralEditor';\n"
anchor = "import './OrdersEnterprise.css';\n"
if import_line not in text:
    if anchor not in text:
        raise SystemExit('Orders import anchor not found')
    text = text.replace(anchor, anchor + import_line, 1)

start_marker = "        {tab === 'items' && <div>"
end_marker = "        {tab === 'payment' &&"
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start == -1 or end == -1:
    raise SystemExit('Orders Items tab markers not found')

replacement = """        {tab === 'items' && <OrderItemStructuralEditor
          orderDbId={order.dbId}
          items={detail.items}
          canEdit={canEdit}
          structuralLocked={Boolean(order.isCancelled || order.isCompleted || order.pickupReadyAt || order.pickupCollectedAt || order.deliveredAt || ['picked_up','shipped','in_transit','out_for_delivery','delivered'].includes(norm(order.shipmentStatusGroup)))}
          structuralLockReason=\"Courier sudah scan / order sudah Ready Pickup, Collected, Delivered atau Cancelled.\"
          onSaved={onReload}
        />}
"""
text = text[:start] + replacement + text[end:]
path.write_text(text)
