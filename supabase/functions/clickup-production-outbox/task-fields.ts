// Pure payload projection. Never mutate queue/component state here.
export const RM_FIELD_ID = '913a7d6e-d1ef-406d-8f0a-bcdce055077e';
export const JOB_FIELD_ID = '83c94d47-6886-4c89-a55f-301f958b9879';

const text = (value: unknown) => value == null ? '' : String(value).trim();
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

const JOBS: Record<string, { label: string; id: string }[]> = {
  edible: [{ label: 'Edible Image', id: '7ce9cddf-c929-44fd-95a2-9769f1ed7ea3' }],
  wafer: [{ label: 'wafer paper', id: 'fd7d7117-aadb-49fe-ad83-5ca7b205a022' }],
  printed: [{ label: 'Cake topper', id: '9cb59719-685e-48c4-b204-c08950298360' }],
  acrylic: [{ label: 'Acrylic cake topper', id: '9d2fd770-0bbe-4bcf-82bf-dff004ebde4f' }],
  mirror: [{ label: 'Artpaper', id: 'f5dc9027-9871-475d-ae8a-d86649e8fc8c' }],
  'print-edible': [{ label: 'print-edible', id: 'fcd6eb8b-c15a-402b-8002-710e8d96a80d' }],
  'print-wafer': [{ label: 'print-wafer', id: 'ababb2e4-235b-416a-b49e-91d524bbffc5' }],
};

function jobFor(component: any, item: any) {
  const normalize = (value: unknown) => text(value).toLowerCase().replace(/[ _]+/g, '-');
  const aliases: Record<string, string> = {
    'edible-image': 'edible', 'wafer-paper': 'wafer',
    topper: 'printed', 'cake-topper': 'printed', 'acrylic-cake-topper': 'acrylic',
    artpaper: 'mirror', 'mirror-gold': 'mirror', 'artpaper-mirror-gold': 'mirror',
    'burn-away': 'burnaway',
  };
  // Resolve the production component first, so Burn Away's edible/wafer tasks
  // never inherit both jobs from their shared commercial parent.
  for (const raw of [component.component_type, item.k, item.product_type]) {
    const normalized = normalize(raw);
    const kind = aliases[normalized] || normalized;
    if (kind === 'burnaway') return [...JOBS.edible, ...JOBS.wafer];
    if (Object.hasOwn(JOBS, kind)) return JOBS[kind];
  }
  // An unknown custom job is not silently labelled as a cake topper.
  return [];
}

export function taskFields(component: any, all: any[], manifest: any) {
  const item = component.order_items || {};
  const jobs = jobFor(component, item);
  const jobOptions = jobs.map(job => job.id);
  const siblings = all.filter((row: any) =>
    component.order_item_id
      ? row.order_item_id === component.order_item_id
      : row.id === component.id
  );
  // all includes already-linked tasks, so retries never shift either price or set.
  const primary = siblings[0] || component;
  const totalItems = new Set(all.map((row: any) =>
    text(row.order_item_id) || text(row.id)
  )).size;
  const setRequired = totalItems > 1;
  const setIndex = Number(component.set_index) ||
    (all.findIndex((row: any) => row.id === component.id) + 1);
  const setField = text(manifest?.field_id);
  const setOption = setRequired
    ? text(component.clickup_set_option_id) ||
      text(manifest?.options?.[String(setIndex)])
    : '';
  const setLabel = setRequired
    ? text(component.set_label) || `set${setIndex}`
    : null;

  const quantity = Number(item.qty ?? 1);
  const rawPrice = item.price;
  const price = rawPrice == null || text(rawPrice) === ''
    ? NaN
    : Number(rawPrice);
  const priceReady = Number.isFinite(price) && price >= 0 &&
    Number.isInteger(quantity) && quantity > 0 &&
    Number.isSafeInteger(cents(price * quantity));
  const unitPrice = priceReady ? cents(price) / 100 : null;
  const itemTotal = priceReady ? cents(price * quantity) / 100 : null;
  // A commercial item can produce several tasks (e.g. edible + wafer).
  // With no separately stored component prices, book its amount once on the
  // first persisted component; the other task is included, never charged twice.
  const isPricePrimary = primary.id === component.id;
  const taskAmount = priceReady ? (isPricePrimary ? itemTotal : 0) : null;
  const customFields: { id: string; value: number | string[] }[] = [];
  if (priceReady) customFields.push({ id: RM_FIELD_ID, value: taskAmount! });
  if (setRequired && setField && setOption) {
    customFields.push({ id: setField, value: [setOption] });
  }
  if (jobOptions.length) customFields.push({ id: JOB_FIELD_ID, value: jobOptions });

  return {
    unit_price: unitPrice,
    item_total: itemTotal,
    task_amount: taskAmount,
    price_ready: priceReady,
    price_source: 'order_items.price',
    price_allocation: siblings.length <= 1
      ? 'single_component'
      : isPricePrimary ? 'primary_component' : 'included_in_primary_component',
    price_primary_component_id: primary.id,
    price_custom_field_id: RM_FIELD_ID,
    price_currency: 'MYR',
    total_items: totalItems,
    set_required: setRequired,
    set_index: setIndex,
    set_label: setLabel,
    set_option_id: setOption || null,
    set_option_ids: setOption ? [setOption] : [],
    set_custom_field_id: setField || null,
    set_manifest_complete: !setRequired || Boolean(setField && setOption),
    job_custom_field_id: JOB_FIELD_ID,
    job_labels: jobs.map(job => job.label),
    job_option_id: jobOptions.length === 1 ? jobOptions[0] : null,
    job_option_ids: jobOptions,
    job_matched: jobOptions.length > 0,
    custom_fields: customFields,
  };
}

