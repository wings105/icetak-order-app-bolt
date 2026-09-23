type Data = Record<string, any>;
// All pages form one snapshot. An edit, navigation or explicit request cancels its application.
export async function refreshSnapshot(call: (body: Data) => Promise<Data>, current: () => boolean,
 scope: {channel: string; search: string; count: number; selectedId?: string}) {
 const rows: Data[] = [];
 let page: Data = {};
 for (let offset = 0; offset < Math.max(30, scope.count); offset += 30) {
  if (!current()) return null;
  page = await call({action: 'list', channel: scope.channel, search: scope.search, offset});
  if (!current()) return null;
  rows.push(...page.rows);
  if (!page.has_more) break;
 }
 const detail = scope.selectedId ? await call({action: 'detail', conversation_id: scope.selectedId}) : null;
 if (!current()) return null;
 const unique = [...new Map(rows.map(r => [r.id, detail && detail.row.id === r.id ? detail.row : r])).values()];
 return {rows: unique, offset: rows.length, has_more: page.has_more, capabilities: detail?.capabilities || page.capabilities,
  fetched_at: detail?.fetched_at || page.fetched_at, detail};
}
