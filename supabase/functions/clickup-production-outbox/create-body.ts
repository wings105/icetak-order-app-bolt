const mapCourier = async (inputs: any) => {
  const raw = String(inputs.delivery_method ?? "").trim();
  const value = raw
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const couriers = [
    {
      name: "J&T",
      option_id: "c036471c-ac91-42df-81f9-400575c9d121",
      aliases: ["j&t", "j&t express", "jnt", "jnt express", "jt", "jt express"],
    },
    {
      name: "Ninjavan",
      option_id: "e8b8b6d2-2d80-42cc-8490-c84f7fea450d",
      aliases: ["ninjavan", "ninja van", "ninja"],
    },
    {
      name: "Poslaju",
      option_id: "3ab7f0f1-9b27-4f1b-8888-6a008554d2c6",
      aliases: ["poslaju", "pos laju"],
    },
    {
      name: "Flash Express",
      option_id: "5b277b00-8129-49c9-855a-4c305b184e51",
      aliases: ["flash express", "flash"],
    },
    {
      name: "Citylink",
      option_id: "be3d3208-c6e0-4304-bbbe-9874b8843adf",
      aliases: ["citylink", "city link"],
    },
    {
      name: "PickUp",
      option_id: "47332e86-6914-4d2f-a000-5a7a543d7c16",
      aliases: ["pickup", "pick up", "self pickup", "self collect", "walk in"],
    },
    {
      name: "SPX",
      option_id: "c7b7ad4d-7dc7-4bd9-8b64-9e182ed3a1b9",
      aliases: ["spx", "spx express", "shopee express"],
    },
    {
      name: "POS Malaysia",
      option_id: "6d340efc-40a2-469c-97c5-556c74939c95",
      aliases: ["pos malaysia"],
    },
  ];

  const courier = couriers.find((item) =>
    item.aliases.some((alias) => value === alias || value.includes(alias))
  );

  return {
    delivery_method_original: raw,
    delivery_method_normalized: value,
    courier_name: courier?.name ?? null,
    courier_option_id: courier?.option_id ?? null,
    courier_matched: Boolean(courier),
  };
};
const mapFields = async (inputs: any) => {
  const c = (
    Array.isArray(inputs.component) ? inputs.component[0] : inputs.component
  ) || {};

  const o = inputs.order || {};

  const customFields = [
    {
      id: "1bf24635-5405-47ec-9985-4b4d21f9c937",
      value: c.webapp_order_id,
    },
    {
      id: "1aa98168-cf59-4f52-a892-3acce4977e52",
      value: c.webapp_component_id,
    },
    {
      id: "a8996f77-fcf9-4804-84bb-89f97905473d",
      value: inputs.clickup_order_customer,
    },
    {
      id: "1a42fde0-d52a-4911-827d-d89e7bd3b7bd",
      value: o.customer_phone,
    },
    {
      id: "7c88d5cf-56e9-4108-86c5-b8e7baaf5bdc",
      value: c.wording,
    },
    {
      id: "7c632306-97cc-40f3-9eb8-2200d32a41e4",
      value: [
        o.delivery_address,
        o.delivery_city,
        o.delivery_postcode,
        o.delivery_state,
      ].filter(Boolean).join(", "),
    },
    {
      id: "1727468c-fd70-488d-a87f-cc727d5d22ae",
      value: o.customer_token,
    },
    {
      id: "3ec35543-1347-4412-9ab1-a00382420dce",
      value: true,
    },
    {
      id: "afa87c64-3e48-4056-b720-cf8ea9b243e8",
      value: true,
    },
    {
      id: "55526fc6-8c57-4fc7-83b5-4c487c94c0c8",
      value: inputs.courier_option_id,
    },

    // Harga dan set yang disediakan oleh queue iCetak.
    ...(Array.isArray(c.custom_fields) ? c.custom_fields : []),
  ].filter((field) =>
    field.value !== null &&
    field.value !== undefined &&
    field.value !== ""
  );

  const rawDate = String(inputs.date_needed || "").trim();

  const dueDateMs = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? new Date(`${rawDate}T12:00:00+08:00`).getTime()
    : null;

  const process = String(
    c.customization?.admin_process || "Pre-order",
  ).trim();

  const review = c.review_required ? "Need Review" : "No Review";

  const referenceUrl = String(
    c.product_snapshot?.image_url ||
      c.customization?.reference_url ||
      "",
  ).trim();

  const baseDescription = String(c.task_description || "").trim();

  const extra = [
    `Process: ${process}`,
    `Review: ${review}`,
    referenceUrl ? `Reference: ${referenceUrl}` : "",
  ].filter(Boolean).join("\n");

  return {
    custom_fields: customFields,
    task_amount: c.task_amount ?? null,
    set_label: c.set_label ?? null,
    due_date_ms: dueDateMs,
    process,
    review,
    reference_url: referenceUrl,
    description: [baseDescription, extra]
      .filter(Boolean)
      .join("\n"),
  };
};
// Mirrors the published AP create payload, including its compact task name.
export async function clickupCreateBody(event: any) {
  const o = event.order, c = event.components[0];
  const courier = await mapCourier({ delivery_method: o.delivery_method });
  const customer =
    String(o.delivery_method || "").trim().toLowerCase().includes("pickup")
      ? String(o.customer_name || o.delivery_name || "Customer").trim()
      : String(o.order_no || o.order_id || "").trim();
  const fields = await mapFields({
    order: o,
    component: c,
    date_needed: o.date_needed,
    courier_option_id: courier.courier_option_id,
    clickup_order_customer: customer,
  });
  return {
    name: `${c.quantity}x ${c.size} ${
      c.component_type === "mirror"
        ? "artpaper"
        : c.component_type === "acrylic"
        ? "acrylic"
        : ""
    } ${c.style}`,
    tags: ["decoshop"],
    status: c.initial_clickup_status,
    due_date: fields.due_date_ms,
    due_date_time: false,
    notify_all: false,
    description:
      `Order ${o.order_no} | Customer ${o.customer_name} | Phone ${o.customer_phone} | Product ${c.title} | Size ${c.size} | Style ${c.style} | Qty ${c.quantity}`,
    custom_fields: fields.custom_fields,
  };
}
