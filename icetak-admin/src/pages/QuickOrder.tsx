import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ADMIN_PRODUCTS, DELIVERY, adminProductPrice, adminProductStyles,
  normalizeMalaysiaPhone, type AdminProductKind, type DeliveryKind, type ProductReview,
} from '../lib/orderProducts';
import { parseMalaysiaAddress, type ParsedMalaysiaAddress } from '../lib/addressParser';

 type ItemDraft = {
  id: string;
  kind: AdminProductKind;
  qty: number;
  process: string;
  size: string;
  style: string;
  review: ProductReview;
  wording: string;
  referenceUrl: string;
};

type QuickResult = {
  order_db_id: string;
  order_id: string;
  order_token: string;
  total: number;
  confirm_token?: string;
  sync?: SyncStatus;
};

type SyncStatus = {
  order?: { db_id: string; order_no: string; order_token: string; payment: string; status: string; production_ready: boolean };
  sync?: { clickup?: ClickupStatus };
  clickup?: ClickupStatus;
};

type ClickupStatus = {
  components_total: number;
  components_linked: number;
  outbox_status?: string;
  outbox_error?: string;
};

type LookupAddress = {
  address_line1?: string;
  address_line2?: string;
  city?: string;
  postcode?: string;
  state?: string;
  is_default?: boolean;
};

type LookupCustomer = { id: string; name: string; phone: string; addresses?: LookupAddress[] };

type PaidItem = {
  id:string; kind:AdminProductKind; title:string; qty:number; price:number; process:string;
  size:string; style:string; review:ProductReview; customText:string; referenceUrl:string;
};

type PaidResult = {
  order_id: string;
  order_db_id: string;
  order_token: string;
  total: number;
  duplicate?: boolean;
  payment?: { transaction_id?: string; verified_by?: string };
};

type Props = {
  permissions?: string[];
  onOpenOrder?: (orderNo: string) => void;
  linkedPayment?: LinkedQrPayment | null;
};

export type LinkedQrPayment = {
  transactionId:string; amount:number; phone:string; customerName:string; paidAt:string;
};

const makeQuickItem = (kind: AdminProductKind): ItemDraft => {
  const p = ADMIN_PRODUCTS[kind];
  return { id: crypto.randomUUID(), kind, qty: 1, process: p.process[0], size: p.defaultSize, style: p.defaultStyle, review: p.defaultReview, wording: '', referenceUrl: '' };
};

const makePaidItem = (kind:AdminProductKind='edible'): PaidItem => {
  const product=ADMIN_PRODUCTS[kind];
  const process=product.process[0],size=product.defaultSize,style=product.defaultStyle,review=product.defaultReview;
  return {id:crypto.randomUUID(),kind,title:product.label,qty:1,price:adminProductPrice(kind,process,size,style,review),process,size,style,review,customText:'',referenceUrl:''};
};

const money = (n: number) => `RM ${Number(n || 0).toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const localDateTime = (value?:string) => {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function QuickOrder({ permissions = [], onOpenOrder, linkedPayment }: Props) {
  const allowed = permissions.includes('quick_arrange') || permissions.includes('create_order');
  const canVerifyPayment = permissions.includes('verify_payments');
  const [mode, setMode] = useState<'quick' | 'paid'>(linkedPayment ? 'paid' : 'quick');

  if (!allowed) {
    return <div className="panel"><div className="empty"><div className="empty-title">Akses Quick Order tidak dibenarkan</div><div>Permission quick_arrange atau create_order diperlukan.</div></div></div>;
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-label">Admin tool</div>
          <h1 className="page-title">Quick Order</h1>
          <p className="page-subtitle">Create order counter, WhatsApp atau paid QR tanpa keluar dari Admin V2</p>
        </div>
      </div>
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        <button className={`filter-tab ${mode === 'quick' ? 'active' : ''}`} onClick={() => setMode('quick')}>Quick Arrange</button>
        <button className={`filter-tab ${mode === 'paid' ? 'active' : ''}`} disabled={!canVerifyPayment} onClick={() => setMode('paid')}>Paid QR / WhatsApp</button>
      </div>
      {mode === 'quick' ? <QuickArrange onOpenOrder={onOpenOrder} /> : <PaidQrOrder onOpenOrder={onOpenOrder} linkedPayment={linkedPayment} />}
    </div>
  );
}

function QuickArrange({ onOpenOrder }: { onOpenOrder?: (orderNo: string) => void }) {
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [delivery, setDelivery] = useState<DeliveryKind>('pickup');
  const [payment, setPayment] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateNeed, setDateNeed] = useState('');
  const [source, setSource] = useState('Walk-in');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [result, setResult] = useState<QuickResult | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());

  const total = useMemo(() => items.reduce((sum, i) => sum + i.qty * adminProductPrice(i.kind, i.process, i.size, i.style, i.review), 0) + DELIVERY[delivery].fee, [items, delivery]);

  const updateItem = (id: string, patch: Partial<ItemDraft>) => setItems((old) => old.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch };
    if (patch.size) {
      const styles = adminProductStyles(next.kind, patch.size);
      if (!styles.includes(next.style)) next.style = styles[0];
    }
    return next;
  }));

  const refreshStatus = async () => {
    if (!result) return;
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_quick_arrange_status', { p_order_id: result.order_db_id });
    if (rpcError) setError(rpcError.message);
    else setSync((data || {}) as SyncStatus);
  };

  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(() => void refreshStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [result?.order_db_id]);

  const reset = () => {
    setItems([]); setDelivery('pickup'); setPayment(''); setName(''); setPhone(''); setDateNeed(''); setSource('Walk-in'); setAddress(''); setNote(''); setNotifyWhatsapp(false); setResult(null); setSync(null); setError(null); requestId.current = crypto.randomUUID();
  };

  const submit = async () => {
    setError(null);
    const normalized = normalizeMalaysiaPhone(phone);
    if (!name.trim()) return setError('Nama customer diperlukan.');
    if (!normalized) return setError('Nombor WhatsApp Malaysia tidak sah.');
    if (!dateNeed) return setError('Date Need diperlukan.');
    if (!payment) return setError('Pilih payment status.');
    if (!items.length) return setError('Tambah sekurang-kurangnya satu produk.');
    if (delivery !== 'pickup' && !address.trim()) return setError('Alamat penghantaran diperlukan.');

    setBusy(true);
    const adminRemark = [`Source: ${source}`, note.trim(), delivery !== 'pickup' ? `Address: ${address.trim()}` : ''].filter(Boolean).join('\n');
    const payload = {
      request_id: requestId.current,
      customer: { name: name.trim(), phone: normalized, address_line1: address.trim(), city: '', postcode: '', state: '', phone_masked: '', address_masked: '' },
      items: items.map((item) => ({
        k: item.kind,
        title: ADMIN_PRODUCTS[item.kind].label,
        process: item.process,
        review: item.review,
        size: item.size,
        style: item.kind === 'burnaway' ? `${item.style} • Edible Image + Wafer Paper` : item.style,
        customText: item.wording.trim(),
        price: adminProductPrice(item.kind, item.process, item.size, item.style, item.review),
        qty: item.qty,
        product_snapshot: item.referenceUrl.trim() ? { image_url: item.referenceUrl.trim(), quick_arrange_kind: item.kind } : { quick_arrange_kind: item.kind },
        customization: item.referenceUrl.trim() ? { reference_url: item.referenceUrl.trim() } : {},
      })),
      date_need: dateNeed,
      delivery,
      delivery_fee: DELIVERY[delivery].fee,
      payment,
      admin_remark: adminRemark,
      notify_whatsapp: notifyWhatsapp,
    };
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_quick_arrange', { p_payload: payload });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    const created = (data || {}) as QuickResult;
    setResult(created);
    setSync(created.sync || null);
  };

  const retryClickup = async () => {
    if (!result) return;
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_quick_arrange_retry', { p_order_id: result.order_db_id });
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else setSync((data || {}) as SyncStatus);
  };

  const clickup = sync?.sync?.clickup || sync?.clickup;
  const clickupDone = Boolean(clickup && clickup.components_total > 0 && clickup.components_linked === clickup.components_total);
  const clickupError = clickup?.outbox_status === 'error' || clickup?.outbox_status === 'retry';

  return (
    <>
      {result && (
        <div className="panel" style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div><div className="panel-title">Order {result.order_id} created</div><div className="panel-subtitle">{clickupDone ? 'ClickUp production components linked.' : clickupError ? (clickup?.outbox_error || 'ClickUp perlu retry.') : 'Order saved. ClickUp sync sedang dipantau.'}</div></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-outline" onClick={() => void refreshStatus()}>Refresh status</button>
              {clickupError && <button className="btn btn-outline" onClick={() => void retryClickup()} disabled={busy}>Retry ClickUp</button>}
              <button className="btn btn-primary" onClick={() => onOpenOrder?.(result.order_id)}>Open Order</button>
              <button className="btn btn-outline" onClick={reset}>New Order</button>
            </div>
          </div>
        </div>
      )}
      {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-header"><div><div className="panel-title">1. Customer & payment</div><div className="panel-subtitle">Order counter / WhatsApp / phone / POS</div></div></div>
          <div style={{ padding: 18, display: 'grid', gap: 12 }}>
            <Field label="Nama customer *"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="No. WhatsApp *"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0123456789" /></Field>
            <Field label="Date Need *"><input type="date" min={today()} value={dateNeed} onChange={(e) => setDateNeed(e.target.value)} /></Field>
            <Field label="Order source"><select value={source} onChange={(e) => setSource(e.target.value)}>{['Walk-in', 'WhatsApp', 'Phone', 'POS'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Delivery"><select value={delivery} onChange={(e) => setDelivery(e.target.value as DeliveryKind)}>{(Object.keys(DELIVERY) as DeliveryKind[]).map((key) => <option key={key} value={key}>{DELIVERY[key].label}{DELIVERY[key].fee ? ` (+${money(DELIVERY[key].fee)})` : ''}</option>)}</select></Field>
            {delivery !== 'pickup' && <Field label="Alamat penghantaran *"><textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>}
            <Field label="Payment *"><select value={payment} onChange={(e) => setPayment(e.target.value)}><option value="">Select...</option><option>Paid</option><option>Unpaid</option><option>Cash Counter</option></select></Field>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} /><span><b>Notify customer via WhatsApp</b><div className="cell-sub">Off by default untuk quick counter.</div></span></label>
            <Field label="Nota admin"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </div>

        <div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-header"><div><div className="panel-title">2. Pilih produk</div><div className="panel-subtitle">Harga ikut variasi V1 yang sedia ada</div></div></div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
              {(Object.keys(ADMIN_PRODUCTS) as AdminProductKind[]).map((kind) => <button key={kind} className="btn btn-outline" onClick={() => setItems((old) => [...old, makeQuickItem(kind)])}>+ {ADMIN_PRODUCTS[kind].shortLabel}</button>)}
            </div>
          </div>
          {items.map((item, index) => <QuickItemCard key={item.id} item={item} index={index} onChange={updateItem} onRemove={() => setItems((old) => old.filter((x) => x.id !== item.id))} />)}
          {!items.length && <div className="panel"><div className="empty"><div className="empty-title">Belum ada produk</div><div>Pilih produk di atas.</div></div></div>}
          <div className="panel" style={{ marginTop: 14, padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div><div className="cell-sub">Order Total</div><div style={{ fontSize: 26, fontWeight: 800 }}>{money(total)}</div></div>
            <button className="btn btn-primary" disabled={busy || !items.length} onClick={() => void submit()}>{busy ? 'Creating...' : 'Create order & arrange'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function QuickItemCard({ item, index, onChange, onRemove }: { item: ItemDraft; index: number; onChange: (id: string, patch: Partial<ItemDraft>) => void; onRemove: () => void }) {
  const product = ADMIN_PRODUCTS[item.kind];
  const styles = adminProductStyles(item.kind, item.size);
  const price = adminProductPrice(item.kind, item.process, item.size, item.style, item.review);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-header"><div><div className="panel-title">{index + 1}. {product.label}</div><div className="panel-subtitle">{money(price)} / unit</div></div><button className="btn btn-outline" onClick={onRemove}>Remove</button></div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <Field label="Process"><select value={item.process} onChange={(e) => onChange(item.id, { process: e.target.value })}>{product.process.map((v) => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Review"><select value={item.review} onChange={(e) => onChange(item.id, { review: e.target.value as ProductReview })}><option>No Review</option><option>Need Review</option></select></Field>
        <Field label="Size"><select value={item.size} onChange={(e) => onChange(item.id, { size: e.target.value })}>{product.sizes.map((v) => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Style / Colour"><select value={item.style} onChange={(e) => onChange(item.id, { style: e.target.value })}>{styles.map((v) => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Qty"><input type="number" min={1} value={item.qty} onChange={(e) => onChange(item.id, { qty: Math.max(1, Number(e.target.value || 1)) })} /></Field>
        <Field label="Wording / detail"><input value={item.wording} onChange={(e) => onChange(item.id, { wording: e.target.value })} /></Field>
        <Field label="Reference URL"><input type="url" value={item.referenceUrl} onChange={(e) => onChange(item.id, { referenceUrl: e.target.value })} placeholder="https://..." /></Field>
      </div>
    </div>
  );
}

function PaidQrOrder({ onOpenOrder, linkedPayment }: { onOpenOrder?: (orderNo: string) => void; linkedPayment?:LinkedQrPayment|null }) {
  const [name, setName] = useState(linkedPayment?.customerName||'');
  const [phone, setPhone] = useState(linkedPayment?.phone||'');
  const [dateNeed, setDateNeed] = useState('');
  const [delivery, setDelivery] = useState<DeliveryKind>('pickup');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [address, setAddress] = useState({ address_line1: '', address_line2: '', city: '', postcode: '', state: '' });
  const [items, setItems] = useState<PaidItem[]>([makePaidItem()]);
  const [adminRemark, setAdminRemark] = useState('');
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [transactionId, setTransactionId] = useState(linkedPayment?.transactionId||'');
  const [senderName, setSenderName] = useState(linkedPayment?.customerName||'');
  const [paidAt, setPaidAt] = useState(localDateTime(linkedPayment?.paidAt));
  const [receiptNote, setReceiptNote] = useState(linkedPayment?'Linked from QRPay Daily':'');
  const [matches, setMatches] = useState<LookupCustomer[]>([]);
  const [addressModal,setAddressModal]=useState(false);
  const [addressPaste,setAddressPaste]=useState('');
  const [addressParse,setAddressParse]=useState<ParsedMalaysiaAddress|null>(null);
  const [result, setResult] = useState<PaidResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const total = useMemo(() => items.reduce((sum, item) => sum + Math.max(1, item.qty) * Math.max(0, item.price), 0) + deliveryFee, [items, deliveryFee]);
  const linkedAmount=Number(linkedPayment?.amount||0);
  const linkedAmountMatches=!linkedPayment||Math.abs(total-linkedAmount)<0.01;
  const addressComplete=Boolean(address.address_line1.trim()&&address.city.trim()&&address.postcode.trim()&&address.state.trim());

  useEffect(() => { if (delivery === 'pickup') setDeliveryFee(0); else setDeliveryFee(DELIVERY[delivery].fee); }, [delivery]);

  const lookup = async () => {
    setError(null);
    if (!phone.trim()) return setError('Masukkan nombor WhatsApp dahulu.');
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_customer_lookup', { p_query: phone.trim() });
    if (rpcError) return setError(rpcError.message);
    setMatches(((data as { matches?: LookupCustomer[] })?.matches || []));
  };

  const useCustomer = (customer: LookupCustomer) => {
    setName(customer.name || ''); setPhone(customer.phone || '');
    const a = [...(customer.addresses || [])].sort((x, y) => Number(Boolean(y.is_default)) - Number(Boolean(x.is_default)))[0];
    if (a) setAddress({ address_line1: a.address_line1 || '', address_line2: a.address_line2 || '', city: a.city || '', postcode: a.postcode || '', state: a.state || '' });
    setMatches([]);
  };

  const parseAddress=()=>{
    const parsed=parseMalaysiaAddress(addressPaste);
    setAddressParse(parsed);
    if(parsed.name)setName(parsed.name);
    if(parsed.phone)setPhone(parsed.phone);
    setAddress((current)=>({
      address_line1:parsed.addressLine1||current.address_line1,
      address_line2:parsed.addressLine2||current.address_line2,
      city:parsed.city||current.city,
      postcode:parsed.postcode||current.postcode,
      state:parsed.state||current.state,
    }));
    if(parsed.addressLine1||parsed.postcode||parsed.city||parsed.state)setAddressModal(false);
  };

  const submit = async () => {
    setError(null);
    const normalized = normalizeMalaysiaPhone(phone);
    if (!normalized) return setError('Nombor WhatsApp Malaysia tidak sah.');
    if (!name.trim()) return setError('Nama customer diperlukan.');
    if (!dateNeed) return setError('Date Need diperlukan.');
    if (!transactionId.trim()) return setError('Transaction/reference ID QR diperlukan.');
    if (!items.length || items.some((i) => !i.title.trim() || i.qty < 1 || i.price < 0)) return setError('Semak item, qty dan harga.');
    if (!linkedAmountMatches) return setError(`Jumlah item + delivery mesti sama dengan QRPay ${money(linkedAmount)}.`);

    setBusy(true);
    const payload = {
      client_request_id: requestId.current,
      customer: { name: name.trim(), phone: normalized, ...address },
      items: items.map((i) => ({
        k:i.kind,title:i.title.trim(),process:i.process,review:i.review,size:i.size,style:i.style,
        customText:i.customText,price:i.price,qty:i.qty,
        product_snapshot:i.referenceUrl.trim()?{image_url:i.referenceUrl.trim(),quick_arrange_kind:i.kind}:{quick_arrange_kind:i.kind},
        customization:i.referenceUrl.trim()?{reference_url:i.referenceUrl.trim()}:{}
      })),
      date_need: dateNeed,
      delivery,
      delivery_fee: deliveryFee,
      admin_remark:[adminRemark.trim(),delivery!=='pickup'&&!addressComplete?'[ADDRESS PENDING - lengkapkan sebelum shipping]':''].filter(Boolean).join('\n'),
      notify_whatsapp: notifyWhatsapp,
      payment: { method: 'Manual QR Pay', transaction_id: transactionId.trim(), sender_name: senderName.trim(), paid_at: paidAt, amount: linkedPayment?linkedAmount:total, receipt_note: receiptNote.trim() },
    };
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_create_whatsapp_paid_order', { p_payload: payload });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setResult((data || {}) as PaidResult);
  };

  return (
    <>
      {linkedPayment&&<div className="finance-alert qrpay-match-success" style={{marginBottom:14}}><b>Create order dari QRPay {linkedPayment.transactionId}</b><span>{money(linkedAmount)} diterima · {linkedPayment.phone||'phone belum dikenal pasti'}. Lengkapkan order dengan jumlah tepat ini; payment akan linked automatik.</span></div>}
      {result && <div className="panel" style={{ marginBottom: 16, padding: 18 }}><div className="panel-title">Paid order {result.order_id} created</div><div className="panel-subtitle">Transaction {result.payment?.transaction_id || transactionId} · {money(result.total)}</div><div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={() => onOpenOrder?.(result.order_id)}>Open Order</button></div></div>}
      {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-header"><div><div className="panel-title">Customer & delivery</div><div className="panel-subtitle">Alamat boleh dilengkapkan kemudian sebelum shipping</div></div><button className="btn btn-outline" onClick={()=>{setAddressParse(null);setAddressModal(true);}}>Paste & Parse Address</button></div>
          <div style={{ padding: 18, display: 'grid', gap: 10 }}>
            <Field label="WhatsApp *"><div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} value={phone} onChange={(e) => setPhone(e.target.value)} /><button className="btn btn-outline" onClick={() => void lookup()}>Find Customer</button></div></Field>
            {matches.length > 0 && <div style={{ display: 'grid', gap: 6 }}>{matches.map((c) => <button key={c.id} className="btn btn-outline" onClick={() => useCustomer(c)}>{c.name} · {c.phone}</button>)}</div>}
            <Field label="Nama *"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Date Need *"><input type="date" min={today()} value={dateNeed} onChange={(e) => setDateNeed(e.target.value)} /></Field>
            <Field label="Delivery"><select value={delivery} onChange={(e) => setDelivery(e.target.value as DeliveryKind)}>{(Object.keys(DELIVERY) as DeliveryKind[]).map((key) => <option key={key} value={key}>{DELIVERY[key].label}</option>)}</select></Field>
            <Field label="Delivery fee"><input type="number" min={0} step="0.1" value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value || 0))} /></Field>
            {delivery !== 'pickup' && <><Field label="Address line 1"><input value={address.address_line1} onChange={(e) => setAddress({ ...address, address_line1: e.target.value })} /></Field><Field label="Address line 2"><input value={address.address_line2} onChange={(e) => setAddress({ ...address, address_line2: e.target.value })} /></Field><Field label="City"><input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} /></Field><Field label="Postcode"><input value={address.postcode} onChange={(e) => setAddress({ ...address, postcode: e.target.value })} /></Field><Field label="State"><input value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} /></Field>{!addressComplete&&<div className="finance-alert"><b>Alamat belum lengkap</b><span>Order masih boleh disimpan. Lengkapkan alamat sebelum proses shipping.</span></div>}</>}
            <Field label="Admin remark"><textarea rows={3} value={adminRemark} onChange={(e) => setAdminRemark(e.target.value)} /></Field>
          </div>
        </div>
        <div>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-header"><div className="panel-title">Items</div><button className="btn btn-outline" onClick={() => setItems((old) => [...old, makePaidItem()])}>+ Add Item</button></div>
            <div style={{ padding: 14, display: 'grid', gap: 12 }}>{items.map((item, index) => <PaidItemRow key={item.id} item={item} index={index} onChange={(patch) => setItems((old) => old.map((x) => x.id === item.id ? { ...x, ...patch } : x))} onRemove={() => setItems((old) => old.filter((x) => x.id !== item.id))} />)}</div>
          </div>
          <div className="panel">
            <div className="panel-header"><div><div className="panel-title">Payment verification</div><div className="panel-subtitle">Manual QR Pay</div></div></div>
            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <Field label="Transaction / Reference ID *"><input value={transactionId} readOnly={Boolean(linkedPayment)} onChange={(e) => setTransactionId(e.target.value)} /></Field>
              <Field label="Sender name"><input value={senderName} onChange={(e) => setSenderName(e.target.value)} /></Field>
              <Field label="Paid at"><input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
              <Field label="Receipt note"><textarea rows={2} value={receiptNote} onChange={(e) => setReceiptNote(e.target.value)} /></Field>
              <label style={{ display: 'flex', gap: 10 }}><input type="checkbox" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} /><span>Notify customer via WhatsApp</span></label>
              {linkedPayment&&!linkedAmountMatches&&<div className="finance-alert"><b>Jumlah belum sama</b><span>Order {money(total)} · QRPay {money(linkedAmount)} · beza {money(Math.abs(total-linkedAmount))}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div className="cell-sub">Verified total</div><div style={{ fontSize: 25, fontWeight: 800 }}>{money(total)}</div></div><button className="btn btn-primary" disabled={busy||!linkedAmountMatches} onClick={() => void submit()}>{busy ? 'Creating...' : linkedPayment?'Create & Link QRPay':'Create Paid Order'}</button></div>
            </div>
          </div>
        </div>
      </div>
      {addressModal&&<AddressPasteModal value={addressPaste} parsed={addressParse} onChange={setAddressPaste} onParse={parseAddress} onClose={()=>setAddressModal(false)}/>}
    </>
  );
}

function PaidItemRow({ item, index, onChange, onRemove }: { item: PaidItem; index: number; onChange: (patch: Partial<PaidItem>) => void; onRemove: () => void }) {
  const product=ADMIN_PRODUCTS[item.kind];
  const styles=adminProductStyles(item.kind,item.size);
  const standardPrice=(patch:Partial<PaidItem>)=>{
    const next={...item,...patch};
    return adminProductPrice(next.kind,next.process,next.size,next.style,next.review);
  };
  return <div style={{ border: '1px solid var(--border-light)', borderRadius: 12, padding: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}><b>Item {index + 1}</b><button className="btn btn-outline" disabled={index === 0} onClick={onRemove}>Remove</button></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}><Field label="Product"><select value={item.kind} onChange={(e) => {const next=makePaidItem(e.target.value as AdminProductKind);onChange({...next,id:item.id});}}>{(Object.keys(ADMIN_PRODUCTS) as AdminProductKind[]).map((k) => <option key={k} value={k}>{ADMIN_PRODUCTS[k].shortLabel}</option>)}</select></Field><Field label="Process"><select value={item.process} onChange={(e)=>{const process=e.target.value;onChange({process,price:standardPrice({process})});}}>{product.process.map((value)=><option key={value}>{value}</option>)}</select></Field><Field label="Review"><select value={item.review} onChange={(e)=>{const review=e.target.value as ProductReview;onChange({review,price:standardPrice({review})});}}><option>No Review</option><option>Need Review</option></select></Field><Field label="Size"><select value={item.size} onChange={(e)=>{const size=e.target.value;const nextStyles=adminProductStyles(item.kind,size);const style=nextStyles.includes(item.style)?item.style:nextStyles[0];onChange({size,style,price:standardPrice({size,style})});}}>{product.sizes.map((value)=><option key={value}>{value}</option>)}</select></Field><Field label="Style / Colour"><select value={item.style} onChange={(e)=>{const style=e.target.value;onChange({style,price:standardPrice({style})});}}>{styles.map((value)=><option key={value}>{value}</option>)}</select></Field><Field label="Qty"><input type="number" min={1} value={item.qty} onChange={(e) => onChange({ qty: Math.max(1, Number(e.target.value || 1)) })} /></Field><Field label="Unit price"><input type="number" min={0} step="0.01" value={item.price} onChange={(e) => onChange({ price: Math.max(0, Number(e.target.value || 0)) })} /></Field><Field label="Wording / detail"><input value={item.customText} onChange={(e) => onChange({ customText: e.target.value })} /></Field><Field label="Reference URL"><input type="url" value={item.referenceUrl} onChange={(e)=>onChange({referenceUrl:e.target.value})} placeholder="https://..."/></Field></div></div>;
}

function AddressPasteModal({value,parsed,onChange,onParse,onClose}:{value:string;parsed:ParsedMalaysiaAddress|null;onChange:(value:string)=>void;onParse:()=>void;onClose:()=>void}){
  return <div className="qrpay-match-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="qrpay-match-dialog" role="dialog" aria-modal="true" aria-labelledby="address-paste-title"><div className="qrpay-match-head"><div><h2 id="address-paste-title">Paste & Parse Address</h2><p>Paste alamat WhatsApp dalam apa-apa format. Semak semula selepas sistem isi form.</p></div><button className="qrpay-match-close" onClick={onClose} aria-label="Close">×</button></div><div className="qrpay-match-body"><textarea rows={8} autoFocus value={value} onChange={(event)=>onChange(event.target.value)} placeholder="Nama, alamat, poskod bandar, negeri, telefon" style={{width:'100%',resize:'vertical'}}/>{parsed&&parsed.missing.length>0&&<div className="finance-alert"><b>Sebahagian maklumat belum dijumpai</b><span>{parsed.missing.join(', ')} — isi secara manual selepas parse.</span></div>}<div style={{display:'flex',justifyContent:'flex-end',gap:8}}><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!value.trim()} onClick={onParse}>Parse & Fill Form</button></div></div></section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>;
}
