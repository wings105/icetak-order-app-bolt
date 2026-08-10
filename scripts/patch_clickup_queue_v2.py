from pathlib import Path

app=Path('icetak-admin/src/App.tsx')
s=app.read_text()
s=s.replace("import Shipping from './pages/Shipping';\n", "import Shipping from './pages/Shipping';\nimport ClickUpQueue from './pages/ClickUpQueue';\n")
s=s.replace("  shipping: { title: 'Shipping & Tracking', subtitle: 'Parcels' },\n", "  shipping: { title: 'Shipping & Tracking', subtitle: 'Parcels' },\n  'clickup-queue': { title: 'ClickUp Queue', subtitle: 'Activepieces production task queue' },\n")
s=s.replace("      case 'shipping': return <Shipping />;\n", "      case 'shipping': return <Shipping />;\n      case 'clickup-queue': return <ClickUpQueue permissions={permissions} onOpenOrder={openOrder} />;\n")
app.write_text(s)

sidebar=Path('icetak-admin/src/components/Sidebar.tsx')
s=sidebar.read_text()
s=s.replace("import { useState } from 'react';", "import { useEffect, useState } from 'react';\nimport { supabase } from '../lib/supabase';")
s=s.replace("  { key: 'shipping', label: 'Shipping', icon: IconShipping },\n", "  { key: 'shipping', label: 'Shipping', icon: IconShipping },\n  { key: 'clickup-queue', label: 'ClickUp Queue', icon: IconIntegration },\n")
needle="  const [expanded, setExpanded] = useState<string | null>(\n    visibleNavItems.find((n) => n.children?.some((c) => c.key === active))?.key ?? null\n  );\n"
insert=needle+"  const [clickupAttention, setClickupAttention] = useState(0);\n  useEffect(() => {\n    let mounted = true;\n    const load = async () => {\n      const { data, error } = await supabase.rpc('icetak_admin_clickup_queue_summary');\n      if (!error && mounted) setClickupAttention(Number((data as { attention?: number } | null)?.attention || 0));\n    };\n    void load();\n    const timer = window.setInterval(() => void load(), 30000);\n    return () => { mounted = false; window.clearInterval(timer); };\n  }, []);\n"
if needle not in s: raise SystemExit('sidebar state marker not found')
s=s.replace(needle,insert)
needle2="              <span className=\"sidebar-item-icon\"><Icon size={18} /></span><span className=\"sidebar-item-label\">{item.label}</span>\n"
repl2=needle2+"              {item.key === 'clickup-queue' && clickupAttention > 0 && <span style={{ marginLeft: 'auto', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{clickupAttention > 99 ? '99+' : clickupAttention}</span>}\n"
if needle2 not in s: raise SystemExit('sidebar label marker not found')
s=s.replace(needle2,repl2)
sidebar.write_text(s)

queue=Path('icetak-admin/src/pages/ClickUpQueue.tsx')
s=queue.read_text().replace("const digits=(v:unknown)=>String(v||'').replace(/\\D/g,'');\n","")
queue.write_text(s)
