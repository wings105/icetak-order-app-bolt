import {exactId, exactReference, sha} from './protocol.ts';

type Dependencies = {
  db: (path: string) => Promise<any>;
  clickup: (path: string) => Promise<any>;
  upstream: (url: string, init: RequestInit) => Promise<Response>;
};

export async function sendOrderImage(args: Record<string, unknown>, deps: Dependencies) {
  const reference = exactReference(args.order_reference);
  const taskId = exactId(args.task_id);
  const attachmentId = String(args.attachment_id);
  if (!/^[-\w.]{1,180}$/.test(attachmentId)) throw Error('INVALID_ATTACHMENT_ID');

  const orders = await deps.db(
    'orders?order_no=eq.' + encodeURIComponent(reference) +
    '&select=id,delivery_phone,whatsapp_opt_in,status,admin_status&limit=2',
  );
  if (orders.length !== 1) throw Error('ORDER_NOT_FOUND');
  const order = orders[0];
  if (order.whatsapp_opt_in === false || /cancel/i.test(order.status + ' ' + order.admin_status)) {
    throw Error('ORDER_WHATSAPP_UNAVAILABLE');
  }
  const phone = String(order.delivery_phone ?? '').replace(/\D/g, '').replace(/^0/, '60');
  if (!/^601\d{8,9}$/.test(phone)) throw Error('ORDER_PHONE_UNAVAILABLE');

  const task = await deps.clickup('task/' + taskId);
  const fieldMatches = task.custom_fields?.some((field: any) =>
    (field.id === '1bf24635-5405-47ec-9985-4b4d21f9c937' && field.value === order.id) ||
    (field.id === 'a8996f77-fcf9-4804-84bb-89f97905473d' && field.value === reference),
  );
  if (!fieldMatches || String(task.id) !== taskId || String(task.list?.id) !== '18375902' || task.archived) {
    throw Error('TASK_ORDER_MISMATCH');
  }
  const attachment = task.attachments?.find((file: any) => file.id === attachmentId);
  if (!attachment || !/\.(jpe?g|png)$/i.test(attachment.title ?? '')) throw Error('IMAGE_ATTACHMENT_NOT_FOUND');
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || url.hostname !== 't3747262.p.clickup-attachments.com' ||
      url.port || url.username || url.password || !url.pathname.startsWith('/t3747262/')) {
    throw Error('UNSUPPORTED_ATTACHMENT_URL');
  }

  const token = Deno.env.get('ICETAK_MCP_WHATSAPP_IMAGE_KEY');
  if (!token) throw Error('WHATSAPP_IMAGE_CLIENT_NOT_CONFIGURED');
  const requestId = 'mcp-image:' + await sha(JSON.stringify([order.id, taskId, attachmentId, phone]));
  const response = await deps.upstream(
    'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/external-whatsapp-send',
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      headers: {'Content-Type': 'application/json', 'x-client-id': 'icetak-mcp-image', 'x-icetak-key': token},
      body: JSON.stringify({request_id: requestId, phone, type: 'image', url_image: url.href}),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (result.error_code === 'template_required') throw Error('WHATSAPP_WINDOW_CLOSED');
  if (!response.ok || result.ok !== true || result.status !== 'sent' ||
      !result.provider_message_id || result.phone !== phone) throw Error('WHATSAPP_IMAGE_SEND_NOT_CONFIRMED');
  return {order_reference: reference, task_id: taskId, attachment_id: attachmentId,
    status: 'sent', message_id: result.provider_message_id, duplicate: result.duplicate === true};
}
