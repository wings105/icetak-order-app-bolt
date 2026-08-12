from pathlib import Path
import subprocess
path='icetak-admin/src/pages/Shipping.tsx'
content=subprocess.check_output(['git','show','3f1bbae7fa26dcb38e637970a781e83b1c2b288c:'+path], text=True)
old="""                        {row.reference && (\n                          <div style={{ marginTop: 3 }}>\n                            <a href={`https://app.clickup.com/t/${CLICKUP_TEAM_ID}/${encodeURIComponent(row.reference)}`} target=\"_blank\" rel=\"noreferrer\" className=\"cell-id\" title=\"Open ClickUp task\" style={{ color: 'var(--primary)', textDecoration: 'none' }}>\n                              {row.reference}\n                            </a>\n                          </div>\n                        )}\n"""
new="""                        {row.reference && /^86[a-z0-9]+$/i.test(row.reference) && (\n                          <div style={{ marginTop: 3 }}>\n                            <a href={`https://app.clickup.com/t/${CLICKUP_TEAM_ID}/${encodeURIComponent(row.reference)}`} target=\"_blank\" rel=\"noreferrer\" className=\"cell-id\" title=\"Open ClickUp task\" style={{ color: 'var(--primary)', textDecoration: 'none' }}>\n                              {row.reference}\n                            </a>\n                          </div>\n                        )}\n                        {row.reference && !/^86[a-z0-9]+$/i.test(row.reference) && !row.order_id && (\n                          <div className=\"cell-sub\" style={{ marginTop: 3 }}>Reference: {row.reference}</div>\n                        )}\n"""
if old not in content:
    raise SystemExit('reference marker not found in known-good Shipping')
content=content.replace(old,new,1)
Path(path).write_text(content)
