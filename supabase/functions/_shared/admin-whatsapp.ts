export async function sendAdminWhatsApp(event: string, text: string, key: string, expectedPhone?: string) {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const deliveryKey = key.length <= 300 ? key : Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
  const response = await fetch(`${url}/functions/v1/whatsapp-send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event_type: event, text, idempotency_key: deliveryKey, expected_admin_phone: expectedPhone }),
    signal: AbortSignal.timeout(40000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.message_id) {
    const detail = data?.error || `admin_whatsapp_http_${response.status}`;
    throw new Error(detail === 'admin_whatsapp_uncertain' ? 'UNCERTAIN: Admin WhatsApp acceptance unknown' : detail);
  }
  return data as { message_id: string; to: string; mode: 'text' };
}
