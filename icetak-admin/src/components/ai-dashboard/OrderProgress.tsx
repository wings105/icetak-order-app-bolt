type Data = Record<string, any>;
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('ms-MY', {timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Belum tersedia';
export default function OrderProgress({work,compact=false}:{work?:Data;compact?:boolean}) {
 if (!work) return null;
 return <section className="ai-order-progress" aria-label="Status kerja order"><strong>{work.title}</strong><p>{work.next}</p>
 {!!work.completed_actions?.length&&<small className="ai-work-retired">✓ Kerja asal selesai: {work.completed_actions.join(' · ')}</small>}
 {!!work.tasks?.length&&<details open={!compact}><summary>{work.tasks.length} task / komponen · status setiap set</summary>{work.tasks.map((t:Data)=><div className="ai-task-progress" key={t.id}><b>{t.set_labels?.join(' / ')||t.title||'Komponen'}</b><span>{t.stage||'Status belum dipastikan'} · {t.status||'—'}</span>{t.progress_percent!=null&&<progress max="100" value={t.progress_percent} aria-label={`Kemajuan ${t.title||'task'}`}/>}<small>{t.source||'ClickUp'} · update {date(t.source_updated_at)}<br/>Snapshot diterima {date(t.observed_at)} · {t.mapping||'Padanan belum jelas'}</small>{t.url&&<a href={t.url} target="_blank" rel="noopener noreferrer">Buka task ↗</a>}</div>)}</details>}
 {!work.tasks?.length&&<small>Belum ada task dipadankan. Semak production sebelum memberi janji siap.</small>}
 </section>;
}
