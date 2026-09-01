import { useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ADMIN_PRODUCTS,
  DELIVERY,
  adminProductStyles,
  normalizeMalaysiaPhone,
  type AdminProductKind,
  type DeliveryKind,
  type ProductReview,
} from '../lib/orderProducts';
import { parseMalaysiaAddress } from '../lib/addressParser';
import {
  EMPTY_ADJUSTMENTS,
  EMPTY_CUSTOMER,
  calculateComposerTotals,
  composerCatalogPrice,
  composerEffectivePrice,
  createComposerPayload,
  isValidWhatsAppUserId,
  makeComposerItem,
  normalizeComposerItem,
  type ComposerAction,
  type ComposerAdjustments,
  type ComposerCustomer,
  type ComposerItem,
} from '../lib/orderComposer';
import './CreateOrder.css';

export type LinkedQrPayment = {
  transactionId: string;
  amount: number;
  phone: string;
  customerName: string;
  paidAt: string;
};

type PaymentChoice = 'prepaid' | 'cash_counter' | 'already_paid' | 'linked_qrpay';
type CustomerMatch = {
  id: string;
  name: string;
  phone: string;
  addresses?: Array<{ address_line1?: string; address_line2?: string; city?: string; postcode?: string; state?: string; is_default?: boolean }>;
};
type ComposerResult = {
  success?: boolean;
  error?: string;
  action?: ComposerAction;
  duplicate?: boolean;
  draft_id?: string;
  review_token?: string;
  review_link?: string;
  order_id?: string;
  order_no?: string;
  order_db_id?: string;
  customer_sent?: boolean;
  notification?: { enabled?: boolean; queued?: boolean; error?: string };
  requires_confirmation?: boolean;
  requires_mismatch_confirmation?: boolean;
  data?: Record<string, unknown>;
};

type Props = {
  permissions?: string[];
  onOpenOrder?: (orderNo: string) => void;
  onOpenDrafts?: () => void;
  linkedPayment?: LinkedQrPayment | null;
};

const money = (value: number) => `RM ${Number(value || 0).toFixed(2)}`;

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: Response }).context
    : null;
  if (context && typeof context.clone === 'function') {
    try {
      const body = await context.clone().json() as { error?: unknown; message?: unknown };
      const detail = String(body?.error || body?.message || '').trim();
      if (detail) return detail;
    } catch {
      try {
        const detail = (await context.clone().text()).trim();
        if (detail) return detail;
      } catch {
        // Fall through to the client error below.
      }
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

const choices: Array<{ key: PaymentChoice; title: string; description: string }> = [
  { key: 'prepaid', title: 'Prepaid / Belum bayar', description: 'Hantar semakan dan payment kepada customer.' },
  { key: 'cash_counter', title: 'Pickup · Cash Counter', description: 'Customer bayar semasa ambil order.' },
  { key: 'already_paid', title: 'Sudah bayar', description: 'Cash, transfer, QR manual atau card.' },
];

export default function CreateOrder({ permissions = [], onOpenOrder, onOpenDrafts, linkedPayment }: Props) {
  const allowed = permissions.includes('create_order') || permissions.includes('quick_arrange');
  const canVerifyPayment = permissions.includes('verify_payments');
  const [customer, setCustomer] = useState<ComposerCustomer>({
    ...EMPTY_CUSTOMER,
    name: linkedPayment?.customerName || '',
    phone: linkedPayment?.phone || '',
  });
  const [items, setItems] = useState<ComposerItem[]>([]);
  const [adjustments, setAdjustments] = useState<ComposerAdjustments>({ ...EMPTY_ADJUSTMENTS });
  const [delivery, setDelivery] = useState<DeliveryKind>('pickup');
  const [payment, setPayment] = useState<PaymentChoice>(linkedPayment ? 'linked_qrpay' : 'prepaid');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [dateNeed, setDateNeed] = useState('');
  const [source, setSource] = useState(linkedPayment ? 'QRPay' : 'WhatsApp');
  const [note, setNote] = useState('');
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [customerMatches, setCustomerMatches] = useState<CustomerMatch[]>([]);
  const [addressPaste, setAddressPaste] = useState('');
  const [addressPasteOpen, setAddressPasteOpen] = useState(false);
  const [addressStatus, setAddressStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [result, setResult] = useState<ComposerResult | null>(null);
  const [busy, setBusy] = useState<ComposerAction | 'lookup' | 'address' | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());

  const totals = useMemo(() => calculateComposerTotals(items, delivery, adjustments), [items, delivery, adjustments]);
  const linkedAmount = Number(linkedPayment?.amount || 0);
  const linkedMatches = !linkedPayment || Math.abs(totals.total - linkedAmount) < 0.01;
  const normalizedPhone = normalizeMalaysiaPhone(customer.phone);
  const validUserId = isValidWhatsAppUserId(customer.bsuid);
  const addressComplete = Boolean(customer.addressLine1.trim() && /^\d{5}$/.test(customer.postcode.trim()) && customer.city.trim() && customer.state.trim());
  const effectivePaymentMode = payment === 'cash_counter' ? 'cash_counter' : 'prepaid';

  if (!allowed) {
    return <div className="panel"><div className="empty"><div className="empty-title">Permission Create Order diperlukan.</div></div></div>;
  }

  const setCustomerField = (field: keyof ComposerCustomer, value: string) => {
    setCustomer((previous) => ({ ...previous, [field]: value }));
    if (field === 'phone') setAddressStatus(null);
  };

  const choosePayment = (mode: PaymentChoice) => {
    if (mode === 'already_paid' && !canVerifyPayment) return;
    setPayment(mode);
    if (mode === 'cash_counter') setDelivery('pickup');
    setError('');
  };

  const updateItem = (id: string, patch: Partial<ComposerItem>) => {
    setItems((current) => current.map((item) => item.id === id ? normalizeComposerItem(item, patch) : item));
  };

  const lookupCustomer = async () => {
    if (!customer.phone.trim()) return setError('Masukkan nombor WhatsApp dahulu.');
    setBusy('lookup');
    setError('');
    const { data, error: lookupError } = await supabase.rpc('icetak_admin_customer_lookup', { p_query: customer.phone.trim() });
    setBusy(null);
    if (lookupError) return setError(lookupError.message);
    const matches = ((data as { matches?: CustomerMatch[] })?.matches || []);
    if (!matches.length) return setAddressStatus({ text: 'Customer belum ada dalam CRM.', error: true });
    setCustomerMatches(matches);
  };

  const selectCustomerMatch = (match: CustomerMatch) => {
    const address = [...(match.addresses || [])].sort((left, right) => Number(Boolean(right.is_default)) - Number(Boolean(left.is_default)))[0];
    setCustomer((previous) => ({
      ...previous,
      name: match.name || previous.name,
      phone: match.phone || previous.phone,
      addressLine1: address?.address_line1 || previous.addressLine1,
      addressLine2: address?.address_line2 || previous.addressLine2,
      city: address?.city || previous.city,
      postcode: address?.postcode || previous.postcode,
      state: address?.state || previous.state,
    }));
    setCustomerMatches([]);
    setAddressStatus({ text: 'Maklumat customer CRM dimasukkan.', error: false });
  };

  const fetchClickupAddress = async () => {
    if (!customer.phone.trim()) return setAddressStatus({ text: 'Masukkan nombor WhatsApp untuk cari alamat customer.', error: true });
    setBusy('address');
    setAddressStatus({ text: 'Mencari Customer CRM, kemudian ClickUp…', error: false });
    const { data, error: invokeError } = await supabase.functions.invoke('draft-address-fetch', {
      body: { mode: 'manual', phone: customer.phone.trim() },
    });
    setBusy(null);
    const response = data as { ok?: boolean; found?: boolean; source?: string; error?: string; customer?: { name?: string; phone?: string }; address?: { address_line1?: string; city?: string; postcode?: string; state?: string } } | null;
    if (invokeError || response?.ok === false) return setAddressStatus({ text: response?.error || invokeError?.message || 'Gagal mencari alamat.', error: true });
    if (!response?.found) return setAddressStatus({ text: 'Alamat tidak dijumpai dalam Customer CRM atau ClickUp.', error: true });
    setCustomer((previous) => ({
      ...previous,
      name: response.customer?.name || previous.name,
      phone: response.customer?.phone || previous.phone,
      addressLine1: response.address?.address_line1 || previous.addressLine1,
      city: response.address?.city || previous.city,
      postcode: response.address?.postcode || previous.postcode,
      state: response.address?.state || previous.state,
    }));
    setAddressStatus({ text: response.source === 'customer_crm' ? 'Alamat Customer CRM dimasukkan. Semak sebelum confirm.' : 'Alamat ClickUp dimasukkan. Semak sebelum confirm.', error: false });
  };

  const parsePastedAddress = () => {
    const parsed = parseMalaysiaAddress(addressPaste);
    setCustomer((previous) => ({
      ...previous,
      name: parsed.name || previous.name,
      phone: parsed.phone || previous.phone,
      addressLine1: parsed.addressLine1 || previous.addressLine1,
      addressLine2: parsed.addressLine2 || previous.addressLine2,
      postcode: parsed.postcode || previous.postcode,
      city: parsed.city || previous.city,
      state: parsed.state || previous.state,
    }));
    setAddressPasteOpen(false);
    setAddressStatus({
      text: parsed.missing.length ? `Alamat dimasukkan. Semak: ${parsed.missing.join(', ')}.` : 'Alamat berjaya diisi daripada text WhatsApp.',
      error: parsed.missing.length > 0,
    });
  };

  const validate = (action: ComposerAction) => {
    if (!items.length) return 'Tambah sekurang-kurangnya satu produk.';
    if (items.some((item) => item.customItem && !item.title.trim())) return 'Isi nama untuk setiap Custom Item.';
    if (items.some((item) => item.qty < 1)) return 'Quantity item mestilah sekurang-kurangnya 1.';
    if (Number(adjustments.discountValue || 0) > 100 && adjustments.discountType === 'percent') return 'Discount peratus tidak boleh melebihi 100%.';
    if (customer.phone.trim() && !normalizedPhone) return 'Nombor WhatsApp Malaysia tidak sah.';
    if (customer.bsuid.trim() && !validUserId) return 'WhatsApp User ID / BSUID tidak sah.';
    if (action === 'save_draft') return '';
    if (!customer.name.trim()) return 'Nama customer diperlukan.';
    if (!normalizedPhone && !validUserId) return 'Nombor WhatsApp atau User ID customer diperlukan.';
    if (!dateNeed) return 'Date diperlukan sebelum order dihantar atau disahkan.';
    if (totals.total <= 0) return 'Jumlah order mesti lebih RM0.';
    if (payment === 'cash_counter' && delivery !== 'pickup') return 'Cash at Counter hanya untuk Pickup.';
    if ((action === 'confirm_paid' || action === 'confirm_qrpay') && !canVerifyPayment) return 'Permission verify_payments diperlukan.';
    if (action === 'confirm_qrpay' && !linkedMatches) return `Jumlah order mesti sama dengan bayaran QRPay ${money(linkedAmount)}.`;
    return '';
  };

  const submit = async (action: ComposerAction, confirmMismatch = false): Promise<void> => {
    const validation = validate(action);
    if (validation) return setError(validation);
    setBusy(action);
    setError('');
    const payload = createComposerPayload({
      customer,
      items,
      adjustments,
      delivery,
      paymentMode: effectivePaymentMode,
      dateNeed,
      source,
      note,
      notifyWhatsapp,
    });
    const { data, error: invokeError } = await supabase.functions.invoke('admin-draft-control', {
      body: {
        action: 'compose_order',
        operation: action,
        request_id: requestId.current,
        payload,
        payment_method: paymentMethod,
        payment_reference: paymentReference.trim(),
        transaction_id: linkedPayment?.transactionId || '',
        linked_amount: linkedPayment?.amount || null,
        confirm_mismatch: confirmMismatch,
        notify_whatsapp: notifyWhatsapp,
      },
    });
    const response = (data || {}) as ComposerResult;
    const invokeMessage = invokeError
      ? await edgeFunctionErrorMessage(invokeError, 'Gagal memproses order.')
      : '';
    setBusy(null);
    if (response.requires_confirmation || response.requires_mismatch_confirmation) {
      if (window.confirm('Maklumat customer atau payment tidak sepadan sepenuhnya. Teruskan link QRPay ini?')) {
        await submit(action, true);
      }
      return;
    }
    if (invokeError || response.success === false) {
      return setError(response.error || invokeMessage || 'Gagal memproses order.');
    }
    setResult({ ...response, action });
  };

  const reset = () => {
    setCustomer({ ...EMPTY_CUSTOMER });
    setItems([]);
    setAdjustments({ ...EMPTY_ADJUSTMENTS });
    setDelivery('pickup');
    setPayment('prepaid');
    setPaymentMethod('bank_transfer');
    setPaymentReference('');
    setDateNeed('');
    setSource('WhatsApp');
    setNote('');
    setNotifyWhatsapp(false);
    setCustomerMatches([]);
    setAddressStatus(null);
    setResult(null);
    setBusy(null);
    setError('');
    requestId.current = crypto.randomUUID();
  };

  const doneOrderNo = result?.order_no || result?.order_id || '';
  const mainAction: ComposerAction = payment === 'cash_counter'
    ? 'confirm_pickup'
    : payment === 'already_paid'
      ? 'confirm_paid'
      : payment === 'linked_qrpay'
        ? 'confirm_qrpay'
        : 'send_customer';
  const mainLabel = payment === 'cash_counter'
    ? 'Confirm Pickup & Create Order'
    : payment === 'already_paid'
      ? 'Confirm Paid & Create Order'
      : payment === 'linked_qrpay'
        ? 'Confirm QRPay & Create Order'
        : 'Send Review & Payment';

  return <div className="composer-page fade-in">
    <header className="composer-heading"><div><div className="page-label">Admin · Unified Order Composer</div><h1 className="page-title">Create Order</h1><p className="page-subtitle">Satu borang untuk prepaid, cash counter, QRPay dan manual order.</p></div><span className="composer-contract">Draft-first · Quick Order pricing</span></header>

    {linkedPayment ? <div className="composer-banner composer-banner-info"><b>QRPay linked: {linkedPayment.transactionId}</b><span>{money(linkedAmount)} diterima · Lengkapkan item supaya jumlah order sama dengan bayaran.</span></div> : null}
    {error ? <div className="composer-banner composer-banner-error">{error}</div> : null}
    {result ? <section className="composer-banner composer-banner-success"><div><b>{doneOrderNo ? `Order ${doneOrderNo} berjaya dicipta` : result.customer_sent ? 'Draft disimpan dan dihantar kepada customer' : 'Draft berjaya disimpan'}</b><span>{doneOrderNo ? 'Order sudah masuk production / ClickUp mengikut flow sedia ada.' : result.customer_sent ? 'Customer boleh semak dan membuat bayaran. Order belum dicipta.' : 'Draft boleh disambung semula melalui Draft Orders.'}</span></div><div className="composer-result-actions">{doneOrderNo ? <button className="btn btn-primary" onClick={() => onOpenOrder?.(doneOrderNo)}>Open Order</button> : result.review_link ? <a className="btn btn-outline" href={result.review_link} target="_blank" rel="noreferrer">Open Draft</a> : null}<button className="btn btn-outline" onClick={() => onOpenDrafts?.()}>Draft Orders</button><button className="btn btn-outline" onClick={reset}>New Order</button></div></section> : null}

    <div className="composer-layout">
      <section className="panel composer-panel composer-customer-panel"><div className="panel-header"><div><div className="panel-title">1. Customer & payment</div><div className="panel-subtitle">WhatsApp, walk-in, pickup dan QRPay dalam satu tempat.</div></div></div><div className="composer-section-body">
        <Field label="Nama customer *"><input value={customer.name} onChange={(event) => setCustomerField('name', event.target.value)} placeholder="Nama customer" /></Field>
        <Field label="No. WhatsApp / penerima"><div className="composer-inline-input"><input value={customer.phone} onChange={(event) => setCustomerField('phone', event.target.value)} placeholder="6012..." /><button className="btn btn-outline" onClick={() => void lookupCustomer()} disabled={busy !== null}>{busy === 'lookup' ? 'Cari…' : 'Cari CRM'}</button></div></Field>
        {customerMatches.length ? <div className="composer-match-list">{customerMatches.map((match) => <button type="button" key={match.id} onClick={() => selectCustomerMatch(match)}><b>{match.name}</b><span>{match.phone}</span></button>)}</div> : null}
        <div className="composer-two-fields"><Field label="WhatsApp User ID / BSUID"><input value={customer.bsuid} onChange={(event) => setCustomerField('bsuid', event.target.value)} placeholder="MY.123456..." /></Field><Field label="Username"><input value={customer.username} onChange={(event) => setCustomerField('username', event.target.value)} placeholder="@username" /></Field></div>
        {normalizedPhone ? <div className="composer-contact-links"><a href={`tel:${normalizedPhone}`}>☎ {normalizedPhone}</a><a href={`https://wa.me/${normalizedPhone}`} target="_blank" rel="noreferrer">WhatsApp</a>{customer.username ? <span>@{customer.username.replace(/^@+/, '')}</span> : null}</div> : validUserId ? <div className="composer-contact-links"><span>WhatsApp API: {customer.bsuid.trim()}</span>{customer.username ? <span>@{customer.username.replace(/^@+/, '')}</span> : null}</div> : null}
        <div className="composer-two-fields"><Field label="Date *"><input type="date" value={dateNeed} onChange={(event) => setDateNeed(event.target.value)} /></Field><Field label="Order source"><select value={source} onChange={(event) => setSource(event.target.value)}>{['WhatsApp', 'Walk-in', 'Phone', 'POS', 'Shopee', 'QRPay', 'Manual'].map((option) => <option key={option}>{option}</option>)}</select></Field></div>
        <Field label="Delivery"><select value={delivery} onChange={(event) => { const next = event.target.value as DeliveryKind; setDelivery(next); if (next !== 'pickup' && payment === 'cash_counter') setPayment('prepaid'); }}>{(Object.keys(DELIVERY) as DeliveryKind[]).map((key) => <option key={key} value={key}>{DELIVERY[key].label}{DELIVERY[key].fee ? ` (+${money(DELIVERY[key].fee)})` : ''}</option>)}</select></Field>

        <div className="composer-payment-section"><div className="composer-label">Payment flow</div>{linkedPayment ? <div className="composer-payment-option selected"><b>QRPay sudah diterima</b><span>{linkedPayment.transactionId} · {money(linkedAmount)}</span></div> : choices.map((choice) => <button key={choice.key} type="button" className={`composer-payment-option ${payment === choice.key ? 'selected' : ''}`} disabled={choice.key === 'already_paid' && !canVerifyPayment} onClick={() => choosePayment(choice.key)}><b>{choice.title}</b><span>{choice.key === 'already_paid' && !canVerifyPayment ? 'Permission verify_payments diperlukan.' : choice.description}</span></button>)}</div>
        {payment === 'already_paid' ? <div className="composer-paid-fields"><Field label="Payment method"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="bank_transfer">Bank Transfer / DuitNow</option><option value="qr_pay_manual">QR Pay (Manual)</option><option value="card">Card</option><option value="other">Cash / Other</option></select></Field><Field label="Payment reference / note"><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Resit, DuitNow reference, cash..." /></Field></div> : null}

        <div className="composer-address-head"><div className="composer-label">Alamat customer</div><div><button type="button" className="btn btn-outline" onClick={() => void fetchClickupAddress()} disabled={busy !== null}>{busy === 'address' ? 'Mencari…' : 'Cari Alamat Customer'}</button><button type="button" className="btn btn-outline" onClick={() => setAddressPasteOpen(true)} disabled={busy !== null}>Paste Address</button></div></div>
        {addressStatus ? <div className={`composer-helper ${addressStatus.error ? 'error' : 'success'}`}>{addressStatus.text}</div> : null}
        <Field label="Address line 1"><textarea rows={3} value={customer.addressLine1} onChange={(event) => setCustomerField('addressLine1', event.target.value)} placeholder={delivery === 'pickup' ? 'Optional untuk pickup' : 'Boleh lengkapkan sebelum shipping'} /></Field>
        <Field label="Address line 2"><input value={customer.addressLine2} onChange={(event) => setCustomerField('addressLine2', event.target.value)} /></Field>
        <div className="composer-two-fields"><Field label="Postcode"><input value={customer.postcode} onChange={(event) => setCustomerField('postcode', event.target.value)} /></Field><Field label="City"><input value={customer.city} onChange={(event) => setCustomerField('city', event.target.value)} /></Field></div>
        <Field label="State"><input value={customer.state} onChange={(event) => setCustomerField('state', event.target.value)} /></Field>
        {delivery !== 'pickup' && !addressComplete ? <div className="composer-helper warning">Alamat boleh dilengkapkan kemudian, tetapi wajib sebelum booking courier / AWB.</div> : null}
        {delivery !== 'pickup' && !normalizedPhone && validUserId ? <div className="composer-helper warning">WhatsApp boleh dihantar melalui User ID. Nombor penerima masih diperlukan sebelum AWB.</div> : null}
        <Field label="Nota admin"><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Arahan khas atau remark order" /></Field>
        <label className="composer-notification"><input type="checkbox" checked={notifyWhatsapp} onChange={(event) => setNotifyWhatsapp(event.target.checked)} /><span><b>Hantar notifikasi WhatsApp selepas order dicipta</b><small>Prepaid review tetap dihantar apabila tekan Send Review & Payment.</small></span></label>
      </div></section>

      <div className="composer-right-column"><section className="panel composer-panel"><div className="panel-header"><div><div className="panel-title">2. Pilih produk</div><div className="panel-subtitle">Harga katalog kekal; seller deal boleh diubah untuk setiap item.</div></div></div><div className="composer-product-buttons">{(Object.keys(ADMIN_PRODUCTS) as AdminProductKind[]).map((kind) => <button key={kind} type="button" className="btn btn-outline" onClick={() => setItems((current) => [...current, makeComposerItem(kind)])}>+ {ADMIN_PRODUCTS[kind].shortLabel}</button>)}<button type="button" className="btn btn-outline composer-custom-button" onClick={() => setItems((current) => [...current, makeComposerItem('printed', true)])}>+ Custom Item</button></div></section>
      {items.length ? <div className="composer-items">{items.map((item, index) => <ComposerItemCard key={item.id} item={item} index={index} onChange={updateItem} onRemove={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} />)}</div> : <section className="panel composer-empty"><b>Belum ada produk</b><span>Pilih produk katalog atau Custom Item di atas.</span></section>}

      <section className="panel composer-panel composer-adjustments"><div className="panel-header"><div><div className="panel-title">3. Price adjustments</div><div className="panel-subtitle">Add-on, discount dan rounding direkod berasingan daripada harga katalog.</div></div></div><div className="composer-adjustment-grid"><Field label="Custom Add-on +RM"><input type="number" min="0" step="0.01" value={adjustments.customAddon} onChange={(event) => setAdjustments((previous) => ({ ...previous, customAddon: event.target.value }))} placeholder="0.00" /></Field><Field label="Add-on reason"><input value={adjustments.customAddonReason} onChange={(event) => setAdjustments((previous) => ({ ...previous, customAddonReason: event.target.value }))} placeholder="Contoh: extra custom design" /></Field><Field label="Discount type"><select value={adjustments.discountType} onChange={(event) => setAdjustments((previous) => ({ ...previous, discountType: event.target.value as 'amount' | 'percent' }))}><option value="amount">RM</option><option value="percent">%</option></select></Field><Field label="Discount value"><input type="number" min="0" step="0.01" value={adjustments.discountValue} onChange={(event) => setAdjustments((previous) => ({ ...previous, discountValue: event.target.value }))} placeholder="0.00" /></Field><Field label="Discount reason"><input value={adjustments.discountReason} onChange={(event) => setAdjustments((previous) => ({ ...previous, discountReason: event.target.value }))} placeholder="Optional" /></Field><Field label="Rounding +/-RM"><input type="number" step="0.01" value={adjustments.rounding} onChange={(event) => setAdjustments((previous) => ({ ...previous, rounding: event.target.value }))} placeholder="Contoh: -0.50" /></Field><Field label="Rounding reason"><input value={adjustments.roundingReason} onChange={(event) => setAdjustments((previous) => ({ ...previous, roundingReason: event.target.value }))} placeholder="Optional" /></Field></div></section>

      <section className="panel composer-summary"><div><span>Order Total</span><strong>{money(totals.total)}</strong><small>Catalog items: {money(totals.catalogSubtotal)}</small></div><div className="composer-metrics"><Metric label="Items" value={totals.itemSubtotal} /><Metric label="Add-on" value={totals.addon} /><Metric label="Discount" value={-totals.discountAmount} /><Metric label="Shipping" value={totals.shipping} /><Metric label="Rounding" value={totals.rounding} />{totals.sellerDealSavings > 0 ? <Metric label="Seller deal" value={-totals.sellerDealSavings} /> : null}</div></section>
      {linkedPayment && !linkedMatches ? <div className="composer-banner composer-banner-warning">Jumlah order {money(totals.total)} belum sama dengan payment QRPay {money(linkedAmount)}.</div> : null}
      </div>
    </div>

    <footer className="composer-sticky-actions"><button className="btn btn-outline" disabled={busy !== null || !items.length} onClick={() => void submit('save_draft')}>{busy === 'save_draft' ? 'Saving…' : 'Save Draft'}</button><button className="btn btn-primary" disabled={busy !== null || !items.length || (payment === 'linked_qrpay' && !linkedMatches)} onClick={() => void submit(mainAction)}>{busy === mainAction ? 'Processing…' : mainLabel}</button>{payment === 'prepaid' && canVerifyPayment ? <button className="btn composer-paid-shortcut" disabled={busy !== null || !items.length} onClick={() => choosePayment('already_paid')}>Customer Already Paid</button> : null}<span>{payment === 'prepaid' ? 'Order / ClickUp hanya selepas customer confirm dan bayar.' : payment === 'cash_counter' ? 'Pickup order terus masuk production; payment dikutip di kaunter.' : 'Payment disahkan sebelum order + ClickUp dicipta.'}</span></footer>

    {addressPasteOpen ? <div className="composer-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddressPasteOpen(false); }}><section className="composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-address-title"><header><div><h2 id="composer-address-title">Paste & Parse Address</h2><p>Paste alamat WhatsApp; sistem cuba asingkan nama, telefon, poskod, bandar dan negeri.</p></div><button className="btn btn-outline" onClick={() => setAddressPasteOpen(false)}>×</button></header><textarea rows={8} autoFocus value={addressPaste} onChange={(event) => setAddressPaste(event.target.value)} placeholder="Nama customer, alamat, poskod bandar, negeri, nombor telefon" /><footer><button className="btn btn-outline" onClick={() => setAddressPasteOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!addressPaste.trim()} onClick={parsePastedAddress}>Parse & Fill Form</button></footer></section></div> : null}
  </div>;
}

function ComposerItemCard({ item, index, onChange, onRemove }: { item: ComposerItem; index: number; onChange: (id: string, patch: Partial<ComposerItem>) => void; onRemove: () => void }) {
  const product = ADMIN_PRODUCTS[item.kind];
  const catalog = composerCatalogPrice(item);
  const effective = composerEffectivePrice(item);
  return <section className="panel composer-item-card"><div className="composer-item-header"><div><strong>{index + 1}. {item.customItem ? (item.title.trim() || 'Custom Item') : product.label}</strong><span>Catalog {money(catalog)} / unit{item.sellerDealPrice.trim() !== '' ? ` · Seller deal ${money(effective)}` : ''}</span></div><button type="button" className="btn btn-outline" onClick={onRemove}>Remove</button></div><div className="composer-item-grid">{item.customItem ? <><Field label="Product category"><select value={item.kind} onChange={(event) => onChange(item.id, { kind: event.target.value as AdminProductKind })}>{(Object.keys(ADMIN_PRODUCTS) as AdminProductKind[]).map((kind) => <option key={kind} value={kind}>{ADMIN_PRODUCTS[kind].label}</option>)}</select></Field><Field label="Custom item name *"><input value={item.title} onChange={(event) => onChange(item.id, { title: event.target.value })} placeholder="Contoh: Design sticker custom" /></Field></> : null}<Field label="Process"><select value={item.process} onChange={(event) => onChange(item.id, { process: event.target.value })}>{product.process.map((option) => <option key={option}>{option}</option>)}</select></Field><Field label="Review"><select value={item.review} onChange={(event) => onChange(item.id, { review: event.target.value as ProductReview })}><option>No Review</option><option>Need Review</option></select></Field><Field label="Size"><select value={item.size} onChange={(event) => onChange(item.id, { size: event.target.value })}>{product.sizes.map((option) => <option key={option}>{option}</option>)}</select></Field><Field label="Style / Colour"><select value={item.style} onChange={(event) => onChange(item.id, { style: event.target.value })}>{adminProductStyles(item.kind, item.size).map((option) => <option key={option}>{option}</option>)}</select></Field><Field label="Qty"><input type="number" min="1" value={item.qty} onChange={(event) => onChange(item.id, { qty: Number(event.target.value || 1) })} /></Field><Field label="Seller deal / unit"><input type="number" min="0" step="0.01" value={item.sellerDealPrice} placeholder={catalog.toFixed(2)} onChange={(event) => onChange(item.id, { sellerDealPrice: event.target.value })} /></Field><Field label="Price reason"><input value={item.priceReason} onChange={(event) => onChange(item.id, { priceReason: event.target.value })} placeholder="Contoh: special deal" /></Field><Field label="Wording / detail"><input value={item.wording} onChange={(event) => onChange(item.id, { wording: event.target.value })} /></Field><Field label="Reference URL"><input type="url" value={item.referenceUrl} onChange={(event) => onChange(item.id, { referenceUrl: event.target.value })} placeholder="https://..." /></Field></div></section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><b>{value < 0 ? `- ${money(Math.abs(value))}` : money(value)}</b></div>;
}
