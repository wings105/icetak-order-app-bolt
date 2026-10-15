import { ShopeeSticker, officialOrangutanSticker } from './shopeeStickers';
import { supabase } from './supabase';
import { Message } from '../types';

async function requireStaffSession(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw new Error(`Pengesahan gagal: ${error.message}`);
  if (!session) throw new Error('Sila log masuk sebagai staf ICETAK.');
  return session.access_token;
}

export interface SendMessageParams {
  conversationId: string | null;
  orderSummaryId?: string | null;
  orderId: string | null;
  channel: string;
  text: string;
}

export interface SendMediaParams {
  conversationId: string | null;
  orderSummaryId?: string | null;
  orderId: string | null;
  channel: string;
  file: File;
  caption?: string;
}

export async function sendTestMessage(params: SendMessageParams): Promise<Message> {
  if (params.channel === 'shopee') {
    const token = await requireStaffSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const response = await fetch(`${supabaseUrl}/functions/v1/shopee-chat-send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        conversation_id: params.conversationId,
        order_summary_id: params.orderSummaryId,
        order_no: params.orderId,
        text: params.text,
      }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(payload.error ?? `Penghantaran Shopee gagal (${response.status}).`));
    }
    return {
      id: String(payload.local_message_id ?? payload.message_id ?? `shopee-sent-${Date.now()}`),
      content: params.text,
      direction: 'outbound',
      timestamp: new Date(),
      status: 'sent',
      messageType: 'text',
      providerMessageId: payload.provider_message_id ? String(payload.provider_message_id) : undefined,
    };
  }
  if (params.channel !== 'whatsapp') {
    throw new Error('Channel penghantaran ini belum disokong.');
  }
  if (!params.conversationId) throw new Error('Conversation WhatsApp belum dipautkan kepada order ini.');

  const token = await requireStaffSession();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/wasapflow-send-text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: params.conversationId,
      text: params.text,
    }),
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Penghantaran gagal (${response.status}).`));
  }

  return {
    id: String(payload.local_message_id ?? payload.message_id ?? `sent-${Date.now()}`),
    content: params.text,
    direction: 'outbound',
    timestamp: new Date(),
    status: 'sent',
    messageType: 'text',
  };
}

export async function sendMediaMessage(params: SendMediaParams): Promise<Message> {
  if (params.channel === 'shopee') {
    const token = await requireStaffSession();
    const form = new FormData();
    if (params.conversationId) form.append('conversation_id', params.conversationId);
    if (params.orderSummaryId) form.append('order_summary_id', params.orderSummaryId);
    if (params.orderId) form.append('order_no', params.orderId);
    form.append('request_id', crypto.randomUUID());
    form.append('file', params.file);
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopee-chat-send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || payload.ok !== true) throw new Error(String(payload.error ?? 'Penghantaran gambar Shopee gagal.'));
    if (params.caption?.trim()) {
      try {
        await sendTestMessage({ ...params, text: params.caption.trim() });
      } catch {
        throw new Error('Gambar sudah dihantar, tetapi teks gagal dihantar. Hantar semula teks sahaja.');
      }
    }
    return {
      id: String(payload.local_message_id), content: '[Image]', direction: 'outbound',
      timestamp: new Date(), status: 'sent', messageType: 'image',
      mediaUrl: payload.media_url ? String(payload.media_url) : undefined,
      providerMessageId: payload.provider_message_id ? String(payload.provider_message_id) : undefined,
    };
  }
  if (params.channel !== 'whatsapp') {
    throw new Error('Penghantaran media untuk channel ini belum disokong.');
  }
  if (!params.conversationId) throw new Error('Conversation WhatsApp belum dipautkan kepada order ini.');

  const token = await requireStaffSession();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  const formData = new FormData();
  formData.append('conversation_id', params.conversationId);
  formData.append('file', params.file);
  if (params.caption) formData.append('caption', params.caption);

  const response = await fetch(`${supabaseUrl}/functions/v1/wasapflow-send-media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Penghantaran gagal (${response.status}).`));
  }

  return {
    id: String(payload.local_message_id ?? payload.message_id ?? `sent-${Date.now()}`),
    content: params.caption ?? '[Image]',
    direction: 'outbound',
    timestamp: new Date(),
    status: 'sent',
    messageType: 'image',
  };
}


export async function sendStickerMessage(params: Omit<SendMessageParams, 'text'> & {sticker:ShopeeSticker}):Promise<Message> {
  const sticker=officialOrangutanSticker(params.sticker);
  if(params.channel!=='shopee'||!sticker)throw new Error('Pilih sticker rasmi orangutan Shopee.');
  const token=await requireStaffSession();
  const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopee-chat-send`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({request_id:crypto.randomUUID(),conversation_id:params.conversationId,order_summary_id:params.orderSummaryId,order_no:params.orderId,message_type:'sticker',sticker:{sticker_id:sticker.sticker_id,sticker_package_id:sticker.sticker_package_id}}),
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload.ok!==true)throw new Error(String(payload.error||'Sticker gagal dihantar. Semak Shopee sebelum cuba semula.'));
  return {id:String(payload.local_message_id),content:'[Sticker]',direction:'outbound',timestamp:new Date(),status:'sent',messageType:'sticker',mediaUrl:sticker.url,mediaMetadata:{sticker_id:sticker.sticker_id,sticker_package_id:sticker.sticker_package_id},providerMessageId:payload.provider_message_id};
}
