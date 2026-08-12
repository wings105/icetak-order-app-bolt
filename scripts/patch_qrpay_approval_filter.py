from pathlib import Path
p=Path('icetak-admin/src/pages/QrPayDailySummary.tsx')
s=p.read_text()
old="""  if(progress.available_actions.includes('approve_production'))return 'approval';\n"""
new="""  if(progress.available_actions.includes('approve_production')||(!progress.production_approved&&Boolean(progress.approval_blockers?.length)))return 'approval';\n"""
if old not in s: raise SystemExit('progress approval marker not found')
s=s.replace(old,new,1)
p.write_text(s)
