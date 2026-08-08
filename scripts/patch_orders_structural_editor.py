from pathlib import Path

path = Path('icetak-admin/src/components/OrderItemStructuralEditor.tsx')
text = path.read_text()

old = "if (!canEdit || !drafts.length) return;\n    setError(null); setNotice(null);"
new = "if (!canEdit || !drafts.length) return;\n    if (structuralLocked) { setError(structuralLockReason || 'Editing dikunci untuk order ini.'); return; }\n    setError(null); setNotice(null);"
if old in text:
    text = text.replace(old, new, 1)

text = text.replace('disabled={!canEdit}', 'disabled={!canEdit || structuralLocked}')
text = text.replace('disabled={saving || !drafts.length}', 'disabled={saving || !drafts.length || structuralLocked}')

path.write_text(text)
