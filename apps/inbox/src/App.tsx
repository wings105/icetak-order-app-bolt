import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Conversation, Message } from './types';
import { UnifiedInboxList } from './components/UnifiedInboxList';
import { ChatArea } from './components/ChatArea';
import { ConversationWorkspaceSidebar } from './components/ConversationWorkspaceSidebar';
import { OrderOnlySidebar } from './components/OrderOnlySidebar';
import { AuthGate } from './components/AuthGate';
import { WindowMonitor } from './components/WindowMonitor';
import { TemplateManagerV2 } from './components/TemplateManagerV2';
import { QuickSnippetManager } from './components/QuickSnippetManager';
import { TagManager } from './components/TagManager';
import { ContactsPage } from './components/ContactsPage';
import { ActiveOrdersPage } from './components/ActiveOrdersPage';
import { WebhookForwardSettings } from './components/WebhookForwardSettings';
import { RealtimeReloader } from './components/RealtimeReloader';
import { MobileBackGuard } from './components/MobileBackGuard';
import { useConversations, useMessages } from './lib/hooks';
import { useOrderSessionStatuses } from './lib/useOrderSessionStatuses';
import { useConversationTags } from './lib/conversationTags';
import { normalizePhone, useGoogleContactNames } from './lib/googleContactCache';
import { ExternalOrderSummary, findExternalOrderConversationId, getExternalOrderSummary } from './lib/externalOrderSummaries';
import { sendTestMessage, sendMediaMessage } from './lib/sendMessage';
import {
  markConversationReplied,
  markConversationUnread,
  setConversationArchived,
  setConversationUrgent,
} from './lib/conversationActions';
import { Loader2, WifiOff, MessageSquareText, Clock3, LayoutTemplate, Zap, Tags, Contact, PackageCheck, Settings, Moon, Sun } from 'lucide-react';

type ConvOverride = Partial<Pick<Conversation, 'unreadCount' | 'isUrgent' | 'isArchived' | 'needsReply' | 'lastMessageSender'>>;
type Page = 'inbox' | 'orders' | 'monitor' | 'templates' | 'snippets' | 'tags' | 'contacts' | 'settings';

function pendingConversationId(): string | null {
  return window.sessionStorage.getItem('icetak-open-conversation');
}

function mergeConversationTags(conversations: Conversation[], byConversation: Record<string, Array<{ name: string }>>) {
  return conversations.map((conversation) => ({
    ...conversation,
    customer: { ...conversation.customer, tags: (byConversation[conversation.id] ?? []).map((tag) => tag.name) },
  }));
}

function orderConversationStatus(order: ExternalOrderSummary): Conversation['orderStatus'] {
  const status = [order.order_status, order.shipment_status, order.fulfillment_status].filter(Boolean).join(' ').toUpperCase();
  if (/CANCEL|INVALID|RETURN|REFUND/.test(status)) return 'Gagal';
  if (/COMPLETED|DELIVERY_DONE|DELIVERED/.test(status)) return 'Selesai';
  if (/SHIPPED|PICKUP_DONE|IN_TRANSIT|TO_CONFIRM_RECEIVE/.test(status)) return 'Selesai';
  if (/READY_TO_SHIP|PROCESSED|LOGISTICS_READY|REQUEST_CREATED/.test(status)) return 'Perlu Pos Hari Ini';
  if (String(order.payment_status ?? '').toLowerCase() === 'paid') return 'Dah Bayar';
  return 'Menunggu Balasan';
}

function buildOrderOnlyConversation(order: ExternalOrderSummary, messages: Message[]): Conversation {
  const channel = order.source_channel.toLowerCase() === 'whatsapp' ? 'whatsapp' : 'shopee';
  const customerName = order.shopee_username || order.customer_name || order.customer_phone || 'Customer';
  return {
    id: `order-only:${order.id}`,
    channel,
    customer: {
      id: `order-buyer:${order.shopee_buyer_id || order.customer_phone_normalized || order.id}`,
      name: customerName,
      phone: order.customer_phone || order.customer_phone_normalized || undefined,
      address: order.delivery_address || undefined,
      shopeeUsername: order.shopee_username || undefined,
      notes: order.buyer_message || undefined,
      tags: [],
    },
    messages,
    isArchived: false,
    isUrgent: order.priority_level === 'P0' || order.priority_level === 'P1',
    unreadCount: 0,
    lastInboundAt: channel === 'whatsapp' ? new Date(0) : undefined,
    lastMessageAt: order.order_updated_at ? new Date(order.order_updated_at) : undefined,
    orderStatus: orderConversationStatus(order),
    needsReply: false,
    lastMessageSender: null,
    orderId: order.order_no,
    shopeeOrder: {
      orderId: order.order_no,
      product: order.items[0]?.title || 'Detail item belum diterima',
      variation: order.items[0]?.variation_name || '',
      totalPayment: order.payment_total == null ? '—' : `RM${Number(order.payment_total).toFixed(2)}`,
      paidTime: order.payment_status || 'unknown',
      shipByDate: order.ship_by_at || '',
      trackingNumber: order.tracking_no || undefined,
      orderStatus: order.order_status || order.shipment_status || 'unknown',
    },
    metadata: {
      orderOnly: true,
      orderSummaryId: order.id,
      sourceProject: order.source_project,
      shopeeBuyerId: order.shopee_buyer_id,
      buyerShopId: order.buyer_shop_id,
      shopId: order.shop_id,
    },
  };
}

function InboxApp() {
  const { conversations, loading, error, reload } = useConversations();
  const orderSessionsByConversation = useOrderSessionStatuses(conversations);
  const { tags: allTags, byConversation, reload: reloadTags } = useConversationTags();
  const googleNamesByPhone = useGoogleContactNames(conversations);
  const pendingId = pendingConversationId();
  const [selectedId, setSelectedId] = useState<string | null>(pendingId);
  const [selectedOrder, setSelectedOrder] = useState<ExternalOrderSummary | null>(null);
  const [selectedOrderConversationId, setSelectedOrderConversationId] = useState<string | null>(null);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>(pendingId ? 'chat' : 'list');
  const [composerText, setComposerText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [initialMatchMessageId, setInitialMatchMessageId] = useState<string | undefined>();
  const [overrides, setOverrides] = useState<Record<string, ConvOverride>>({});
  const [optimisticMessages, setOptimisticMessages] = useState<Record<string, Message[]>>({});
  const [msgReloadKey, setMsgReloadKey] = useState(0);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const { messages, loading: msgsLoading } = useMessages(selectedId, msgReloadKey);

  useEffect(() => {
    if (!pendingId || loading) return;
    if (conversations.some((conversation) => conversation.id === pendingId)) {
      setSelectedId(pendingId);
      setMobileView('chat');
    }
    window.sessionStorage.removeItem('icetak-open-conversation');
  }, [pendingId, loading, conversations]);

  const mergedConversations: Conversation[] = useMemo(() => conversations.map((conversation) => {
    const override = overrides[conversation.id] ?? {};
    const extra = optimisticMessages[conversation.id] ?? [];
    const customTags = byConversation[conversation.id] ?? [];
    const normalized = normalizePhone(conversation.customer.phone);
    const googleContact = normalized ? googleNamesByPhone[normalized] : undefined;
    const displayName = googleContact?.display_name || conversation.customer.name;
    const merged: Conversation = {
      ...conversation,
      ...override,
      orderSession: orderSessionsByConversation[conversation.id],
      customer: {
        ...conversation.customer,
        name: displayName,
        tags: customTags.map((tag) => tag.name),
        notes: googleContact ? `${conversation.customer.notes ?? ''}${conversation.customer.notes ? '\n' : ''}Google Contact: ${googleContact.display_name}` : conversation.customer.notes,
      },
    };
    if (conversation.id === selectedId && messages.length > 0) merged.messages = extra.length ? [...messages, ...extra] : messages;
    else if (extra.length) merged.messages = [...(conversation.messages ?? []), ...extra];
    return merged;
  }), [conversations, overrides, selectedId, messages, optimisticMessages, byConversation, googleNamesByPhone, orderSessionsByConversation]);

  const selectedConversation = mergedConversations.find((conversation) => conversation.id === selectedId) ?? null;
  const orderOnlyConversation = useMemo(() => {
    if (!selectedOrder || selectedOrderConversationId) return null;
    const syntheticId = `order-only:${selectedOrder.id}`;
    return buildOrderOnlyConversation(selectedOrder, optimisticMessages[syntheticId] ?? []);
  }, [optimisticMessages, selectedOrder, selectedOrderConversationId]);
  const activeConversation = selectedConversation ?? orderOnlyConversation;

  useEffect(() => {
    if (!activeConversation) {
      window.sessionStorage.removeItem('icetak-snippet-context');
      return;
    }
    window.sessionStorage.setItem('icetak-snippet-context', JSON.stringify({
      name: activeConversation.customer.name ?? '',
      phone: activeConversation.customer.phone ?? '',
      order_id: activeConversation.orderId ?? '',
    }));
  }, [activeConversation]);

  function handleSelect(id: string, firstMatchMsgId?: string) {
    setSelectedOrder(null);
    setSelectedOrderConversationId(null);
    setSelectedId(id);
    setInitialMatchMessageId(firstMatchMsgId);
    setMobileView('chat');
    setComposerText('');
    if (window.innerWidth >= 1100) setShowCustomerPanel(true);
    setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), unreadCount: 0 } }));
  }

  async function handleOrderSelect(orderSummaryId: string, conversationId?: string | null) {
    try {
      const order = await getExternalOrderSummary(orderSummaryId);
      const resolvedConversationId = conversationId ?? await findExternalOrderConversationId(order);
      setSelectedOrder(order);
      setSelectedOrderConversationId(resolvedConversationId);
      setSelectedId(resolvedConversationId);
      setInitialMatchMessageId(undefined);
      setMobileView('chat');
      setShowCustomerPanel(true);
    } catch (reason) {
      console.error('Unable to open order summary', reason);
    }
  }

  function handleBackToList() {
    setMobileView('list');
    setSelectedId(null);
    setSelectedOrder(null);
    setSelectedOrderConversationId(null);
    setShowCustomerPanel(false);
    setInitialMatchMessageId(undefined);
  }

  async function handleArchiveToggle(id: string) {
    const currentOverride = overrides[id]?.isArchived;
    const base = conversations.find((conversation) => conversation.id === id);
    const nextArchived = !(currentOverride ?? base?.isArchived ?? false);
    setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), isArchived: nextArchived } }));
    try {
      await setConversationArchived(id, nextArchived);
      reload();
    } catch {
      setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), isArchived: !nextArchived } }));
    }
  }

  async function handleMarkUnread(id: string) {
    setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), unreadCount: 1 } }));
    try {
      await markConversationUnread(id);
      reload();
    } catch {
      setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), unreadCount: 0 } }));
    }
  }

  async function handleUrgentToggle(id: string) {
    const currentOverride = overrides[id]?.isUrgent;
    const base = conversations.find((conversation) => conversation.id === id);
    const nextUrgent = !(currentOverride ?? base?.isUrgent ?? false);
    setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), isUrgent: nextUrgent } }));
    try {
      await setConversationUrgent(id, nextUrgent);
      reload();
    } catch {
      setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), isUrgent: !nextUrgent } }));
    }
  }

  async function handleMarkReplied(id: string): Promise<void> {
    setOverrides((previous) => ({ ...previous, [id]: { ...(previous[id] ?? {}), needsReply: false, unreadCount: 0 } }));
    await markConversationReplied(id);
    reload();
  }

  async function handleSend(text: string, file?: File | null): Promise<void> {
    if (!activeConversation) return;
    const convId = activeConversation.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const previewUrl = file ? URL.createObjectURL(file) : undefined;
    const tempMsg: Message = { id: tempId, content: file ? (text || '[Image]') : text, direction: 'outbound', timestamp: new Date(), status: 'pending', messageType: file ? 'image' : 'text', mediaUrl: previewUrl };
    setOptimisticMessages((previous) => ({ ...previous, [convId]: [...(previous[convId] ?? []), tempMsg] }));

    const sendToProvider = async () => {
      if (file) await sendMediaMessage({ conversationId: selectedOrderConversationId ?? (selectedConversation ? convId : null), orderId: activeConversation.orderId ?? null, channel: activeConversation.channel, file, caption: text || undefined });
      else await sendTestMessage({ conversationId: selectedOrderConversationId ?? (selectedConversation ? convId : null), orderSummaryId: selectedOrder?.id ?? null, orderId: activeConversation.orderId ?? null, channel: activeConversation.channel, text });
    };
    const queuedSend = sendChainRef.current.then(sendToProvider, sendToProvider);
    sendChainRef.current = queuedSend.catch(() => undefined);

    try {
      await queuedSend;
      setOptimisticMessages(previous => ({...previous,[convId]:(previous[convId] ?? []).map(message => message.id === tempId ? {...message,status:'sent'} : message)}));
      reload();
      setMsgReloadKey((key) => key + 1);
      setTimeout(() => {
        setOptimisticMessages((previous) => {
          const filtered = (previous[convId] ?? []).filter((message) => message.id !== tempId);
          if (!filtered.length) { const next = { ...previous }; delete next[convId]; return next; }
          return { ...previous, [convId]: filtered };
        });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }, 2500);
    } catch (reason) {
      setOptimisticMessages((previous) => ({ ...previous, [convId]: (previous[convId] ?? []).filter((message) => message.id !== tempId) }));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      reload();
      setMsgReloadKey(key => key + 1);
      throw reason;
    }
  }

  const handleRealtimeMessageChange = useCallback((conversationId: string | null) => {
    if (!conversationId || conversationId === selectedId) setMsgReloadKey((key) => key + 1);
  }, [selectedId]);

  if (loading && conversations.length === 0) return <div className="flex h-full items-center justify-center bg-[var(--surface)]"><Loader2 size={32} className="animate-spin text-[#00a884]" /></div>;
  if (error && conversations.length === 0) return <div className="flex h-full items-center justify-center bg-[var(--surface)]"><div className="text-center"><WifiOff size={40} className="mx-auto text-[var(--text-secondary)]" /><p className="mt-3 text-white">Gagal memuatkan data</p><p className="text-sm text-[var(--text-secondary)]">{error}</p><button onClick={reload} className="mt-3 rounded-lg bg-[#00a884] px-4 py-2 text-sm text-white">Cuba Semula</button></div></div>;

  return <div className="flex h-full overflow-hidden bg-[var(--surface)] font-sans antialiased">
    <MobileBackGuard mobileView={mobileView} selectedId={selectedId ?? (selectedOrder ? `order-only:${selectedOrder.id}` : null)} onBackToList={handleBackToList} />
    <RealtimeReloader channelName="icetak-inbox-realtime" onConversationChange={reload} onMessageChange={handleRealtimeMessageChange} />
    <div className={`flex-shrink-0 w-full sm:w-[300px] lg:w-[320px] xl:w-[340px] border-r border-[var(--border)] ${mobileView === 'list' ? 'flex' : 'hidden sm:flex'} flex-col h-full`}><UnifiedInboxList conversations={mergedConversations} selectedId={selectedId} selectedOrderId={selectedOrder?.id ?? null} onSelect={handleSelect} onOrderSelect={(orderId, conversationId) => { void handleOrderSelect(orderId, conversationId); }} searchQuery={searchQuery} onSearchChange={setSearchQuery} /></div>
    <div className={`flex flex-1 min-w-0 h-full ${mobileView === 'chat' ? 'flex' : 'hidden sm:flex'}`}>
      <div className="flex flex-col flex-1 min-w-0"><ChatArea conversation={activeConversation} messagesLoading={selectedId ? msgsLoading : false} orderOnly={Boolean(selectedOrder && !selectedOrderConversationId)} onArchiveToggle={handleArchiveToggle} onMarkUnread={handleMarkUnread} onUrgentToggle={handleUrgentToggle} onShowCustomerPanel={() => setShowCustomerPanel((value) => !value)} onBack={mobileView === 'chat' ? handleBackToList : undefined} showCustomerPanel={showCustomerPanel} composerText={composerText} onComposerChange={setComposerText} onSend={handleSend} searchQuery={searchQuery} initialMatchMessageId={initialMatchMessageId} onMarkReplied={handleMarkReplied} /></div>
      {showCustomerPanel && (activeConversation || selectedOrder) && (
        <div className="fixed inset-0 z-50 h-full w-full flex-shrink-0 overflow-hidden lg:relative lg:inset-auto lg:z-auto lg:w-[320px] xl:w-[360px]">
          {selectedOrder ? (
            <OrderOnlySidebar
              order={selectedOrder}
              conversationId={selectedOrderConversationId}
              onClose={() => setShowCustomerPanel(false)}
              onOpenConversation={handleSelect}
            />
          ) : selectedConversation ? (
            <ConversationWorkspaceSidebar
              conversation={selectedConversation}
              allTags={allTags}
              assignedTags={byConversation[selectedConversation.id] ?? []}
              onTagsChanged={() => { void reloadTags(); }}
              onContactChanged={reload}
              onClose={() => setShowCustomerPanel(false)}
              onFillComposer={setComposerText}
              onOpenConversation={handleSelect}
            />
          ) : null}
        </div>
      )}
    </div>
  </div>;
}

function MonitorPage({ onOpenConversation }: { onOpenConversation: (conversationId: string) => void }) {
  const { conversations, loading, error, reload } = useConversations();
  const { byConversation } = useConversationTags();
  const taggedConversations = useMemo(() => mergeConversationTags(conversations, byConversation), [conversations, byConversation]);
  if (loading && conversations.length === 0) return <div className="flex h-full items-center justify-center bg-[var(--canvas)] text-[var(--text-secondary)]"><Loader2 className="animate-spin" /></div>;
  if (error && conversations.length === 0) return <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--canvas)] text-red-700 dark:text-red-400"><p>{error}</p><button onClick={reload} className="rounded bg-[var(--surface-muted)] px-4 py-2 text-sm text-[var(--text)]">Cuba Semula</button></div>;
  return <><RealtimeReloader channelName="icetak-monitor-realtime" onConversationChange={reload} /><WindowMonitor conversations={taggedConversations} onReload={reload} onOpenConversation={onOpenConversation} /></>;
}

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'orders' || hash === 'monitor' || hash === 'templates' || hash === 'snippets' || hash === 'tags' || hash === 'contacts' || hash === 'settings') return hash;
  return 'inbox';
}

function Dashboard() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.style.colorScheme = next;
    try { window.localStorage.setItem('icetak-inbox-theme-v1', next); } catch { /* Preference storage can be blocked. */ }
  }
  const [page, setPage] = useState<Page>(pageFromHash);
  useEffect(() => {
    function onPopState() { setPage(pageFromHash()); }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  function navigate(p: Page) {
    const hash = p === 'inbox' ? '#inbox' : `#${p}`;
    window.history.pushState({ page: p }, '', `${window.location.pathname}${window.location.search}${hash}`);
    setPage(p);
  }
  function openConversation(conversationId: string) {
    window.sessionStorage.setItem('icetak-open-conversation', conversationId);
    navigate('inbox');
  }
  const items = [
    { id: 'inbox' as const, label: 'Inbox', icon: MessageSquareText },
    { id: 'orders' as const, label: 'Active Orders', icon: PackageCheck },
    { id: 'monitor' as const, label: '24H Monitor', icon: Clock3 },
    { id: 'contacts' as const, label: 'Contacts', icon: Contact },
    { id: 'templates' as const, label: 'Templates', icon: LayoutTemplate },
    { id: 'snippets' as const, label: 'Snippets', icon: Zap },
    { id: 'tags' as const, label: 'Tags', icon: Tags },
    { id: 'settings' as const, label: 'Settings', icon: Settings, Moon, Sun },
  ];
  return <div className="flex h-screen-mobile flex-col bg-[var(--canvas)]">
    <nav className="flex h-12 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 pr-24"><span className="mr-3 hidden text-sm font-semibold text-white sm:block">ICETAK</span>{items.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${page === item.id ? 'bg-[#00a884] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]'}`}><Icon size={15} /> {item.label}</button>; })}</nav>
    <button onClick={toggleTheme} aria-label={theme === 'light' ? 'Tukar ke tema Black' : 'Tukar ke tema White'} title={theme === 'light' ? 'Black theme' : 'White theme'} className="absolute right-14 top-3 z-50 rounded-full bg-[var(--surface-muted)] p-2 text-[var(--text-secondary)]">{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button><main className="min-h-0 flex-1">{page === 'inbox' && <InboxApp />}{page === 'orders' && <ActiveOrdersPage onOpenConversation={openConversation} />}{page === 'monitor' && <MonitorPage onOpenConversation={openConversation} />}{page === 'contacts' && <ContactsPage onOpenConversation={openConversation} />}{page === 'templates' && <TemplateManagerV2 />}{page === 'snippets' && <QuickSnippetManager />}{page === 'tags' && <TagManager />}{page === 'settings' && <WebhookForwardSettings />}</main>
  </div>;
}

export default function App() {
  return <AuthGate><Dashboard /></AuthGate>;
}
