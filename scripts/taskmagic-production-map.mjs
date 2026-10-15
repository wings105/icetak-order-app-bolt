// Paste this entire function into the existing "Map ClickUp Task V2" Code step.
export const code = async (inputs) => {
  const c = (Array.isArray(inputs.component) ? inputs.component[0] : inputs.component) || {};
  const o = inputs.order || {};
  const customFields = [
    { id: '1bf24635-5405-47ec-9985-4b4d21f9c937', value: c.webapp_order_id },
    { id: '1aa98168-cf59-4f52-a892-3acce4977e52', value: c.webapp_component_id },
    { id: 'a8996f77-fcf9-4804-84bb-89f97905473d', value: inputs.clickup_order_customer },
    { id: '1a42fde0-d52a-4911-827d-d89e7bd3b7bd', value: o.customer_phone },
    { id: '7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc', value: c.wording },
    { id: '7c632306-97cc-40f3-9eb8-2200d32a41e4', value: [o.delivery_address, o.delivery_city, o.delivery_postcode, o.delivery_state].filter(Boolean).join(', ') },
    { id: '1727468c-fd70-488d-a87f-cc727d5d22ae', value: o.customer_token },
    { id: '3ec35543-1347-4412-9ab1-a00382420dce', value: true },
    { id: 'afa87c64-3e48-4056-b720-cf8ea9b243e8', value: true },
    { id: '55526fc6-8c57-4fc7-83b5-4c487c94c0c8', value: inputs.courier_option_id },
    ...(Array.isArray(c.custom_fields) ? c.custom_fields : []),
  ].filter(field => field.value !== null && field.value !== undefined && field.value !== '');
  const rawDate = String(inputs.date_needed || '').trim();
  const process = String(c.customization?.admin_process || 'Pre-order').trim();
  const review = c.review_required ? 'Need Review' : 'No Review';
  const referenceUrl = String(c.product_snapshot?.image_url || c.customization?.reference_url || '').trim();
  const extra = [`Process: ${process}`, `Review: ${review}`, referenceUrl ? `Reference: ${referenceUrl}` : ''].filter(Boolean).join('\n');
  return {
    custom_fields: customFields,
    task_amount: c.task_amount ?? null,
    set_label: c.set_label ?? null,
    due_date_ms: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T12:00:00+08:00`).getTime() : null,
    process,
    review,
    reference_url: referenceUrl,
    description: [String(c.task_description || '').trim(), extra].filter(Boolean).join('\n'),
  };
};
