from pathlib import Path
import re

orders = Path('icetak-admin/src/pages/Orders.tsx')
text = orders.read_text()

old_type = "  isProblem?: boolean;\n  urgencyRank?: number;\n};"
new_type = "  isProblem?: boolean;\n  urgencyRank?: number;\n  thumbnailUrl?: string;\n};"
if old_type not in text:
    raise SystemExit('OrderRow type anchor not found')
text = text.replace(old_type, new_type, 1)

load_pattern = re.compile(r"  const load = useCallback\(async \(\) => \{\n.*?\n  \}, \[query, filters, sortKey, sortDir, page, pageSize\]\);", re.S)
load_match = load_pattern.search(text)
if not load_match:
    raise SystemExit('load() block not found')
new_load = """  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_orders_enterprise', {
      p_query: query,
      p_filters: filters,
      p_sort: sortKey,
      p_direction: sortDir,
      p_page: page,
      p_page_size: pageSize,
    });
    if (rpcError) { setLoading(false); setError(rpcError.message); return; }
    const result = (data || {}) as ListResponse;
    let nextRows = result.rows || [];
    if (nextRows.length) {
      const { data: thumbnailRows, error: thumbnailError } = await supabase.rpc('icetak_admin_order_thumbnails', {
        p_order_ids: nextRows.map((row) => row.dbId),
      });
      if (!thumbnailError && Array.isArray(thumbnailRows)) {
        const thumbMap = new Map<string, string>(thumbnailRows.map((row: any) => [String(row.order_id || ''), String(row.thumbnail_url || '')]));
        nextRows = nextRows.map((row) => ({ ...row, thumbnailUrl: thumbMap.get(row.dbId) || '' }));
      }
    }
    setRows(nextRows);
    setSummary(result.summary || {});
    setPagination(result.pagination || { page, pageSize, total: 0, totalPages: 1 });
    setLoading(false);
  }, [query, filters, sortKey, sortDir, page, pageSize]);"""
text = text[:load_match.start()] + new_load + text[load_match.end():]

old_items = "{visible('items') && <td><div className=\"erp-items-summary\"><b>{order.itemsCount || 0} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</b><span>{order.itemSummary || '—'}</span></div></td>}"
new_items = "{visible('items') && <td><div className=\"erp-items-cell\">{order.thumbnailUrl && <a className=\"erp-order-thumb\" href={order.thumbnailUrl} target=\"_blank\" rel=\"noreferrer\" title=\"Open design image\"><img src={order.thumbnailUrl} alt=\"Order preview\" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></a>}<div className=\"erp-items-summary\"><b>{order.itemsCount || 0} item{Number(order.itemsCount || 0) === 1 ? '' : 's'}</b><span>{order.itemSummary || '—'}</span></div></div></td>}"
if old_items not in text:
    raise SystemExit('items cell anchor not found')
text = text.replace(old_items, new_items, 1)
orders.write_text(text)

css = Path('icetak-admin/src/pages/OrdersEnterprise.css')
css_text = css.read_text()
marker = '/* order thumbnail enhancement */'
if marker not in css_text:
    css_text += """

/* order thumbnail enhancement */
.erp-items-cell{display:flex;align-items:center;gap:9px;min-width:220px}
.erp-order-thumb{display:block;flex:0 0 46px;width:46px;height:46px;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:#f8fafc;box-shadow:var(--shadow-sm)}
.erp-order-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.erp-order-thumb:hover{border-color:#93c5fd;box-shadow:0 0 0 2px rgba(37,99,235,.08)}
"""
css.write_text(css_text)
