from pathlib import Path
p=Path('icetak-admin/src/pages/Orders.tsx')
s=p.read_text()
s=s.replace("const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'spx' | 'jnt'>('spx');", "const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'spx' | 'jnt' | 'ninja'>('spx');")
s=s.replace("const method: 'pickup' | 'spx' | 'jnt' = rawDelivery.includes('pickup') ? 'pickup' : (rawDelivery.includes('jnt') || rawDelivery.includes('j&t')) ? 'jnt' : 'spx';", "const method: 'pickup' | 'spx' | 'jnt' | 'ninja' = rawDelivery.includes('pickup') ? 'pickup' : rawDelivery.includes('ninja') ? 'ninja' : (rawDelivery.includes('jnt') || rawDelivery.includes('j&t')) ? 'jnt' : 'spx';")
s=s.replace("<option value=\"pickup\">Pickup</option><option value=\"spx\">SPX</option><option value=\"j&t\">J&T</option><option value=\"jnt\">JNT</option>", "<option value=\"pickup\">Pickup</option><option value=\"spx\">SPX</option><option value=\"j&t\">J&T</option><option value=\"jnt\">JNT</option><option value=\"ninja\">NinjaVan</option>")
s=s.replace("const value = e.target.value as 'pickup' | 'spx' | 'jnt';", "const value = e.target.value as 'pickup' | 'spx' | 'jnt' | 'ninja';")
s=s.replace("<option value=\"pickup\">Pickup</option><option value=\"spx\">SPX</option><option value=\"jnt\">J&amp;T</option></select>", "<option value=\"pickup\">Pickup</option><option value=\"spx\">SPX</option><option value=\"jnt\">J&amp;T</option><option value=\"ninja\">NinjaVan</option></select>")
p.write_text(s)
