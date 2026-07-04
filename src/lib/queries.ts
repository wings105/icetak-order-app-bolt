import { supabase } from './supabase';
import type {
  Customer,
  Order,
  OrderItem,
  ProductionComponent,
  PaymentSession,
  ShipmentEvent,
  DashboardStats,
  OrderStatus,
} from './types';

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.from('orders').select('status, total');
  if (error) throw error;
  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  let revenue = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    revenue += Number(row.total ?? 0);
  }
  return {
    total: rows.length,
    revenue,
    in_production: byStatus['in_production'] ?? 0,
    pending: byStatus['pending'] ?? 0,
    byStatus,
  };
}

export async function fetchRecentOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(id, name, phone)')
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []) as Order[];
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function fetchOrders(
  status: OrderStatus | 'all',
  search: string,
): Promise<Order[]> {
  let q = supabase
    .from('orders')
    .select('*, customers(id, name, phone)')
    .order('created_at', { ascending: false });

  if (status !== 'all') q = q.eq('status', status);
  if (search.trim()) {
    q = q.or(
      `order_no.ilike.%${search.trim()}%,customers.name.ilike.%${search.trim()}%`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function updateOrderRemark(id: string, remark: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ admin_remark: remark })
    .eq('id', id);
  if (error) throw error;
}

// ─── Order Detail ─────────────────────────────────────────────────────────────

export async function fetchOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(id, name, phone)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Order | null;
}

export async function fetchOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrderItem[];
}

export async function fetchProductionComponents(orderId: string): Promise<ProductionComponent[]> {
  const { data, error } = await supabase
    .from('production_components')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProductionComponent[];
}

export async function fetchPaymentSessions(orderId: string): Promise<PaymentSession[]> {
  const { data, error } = await supabase
    .from('payment_sessions')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PaymentSession[];
}

export async function fetchShipmentEvents(orderId: string): Promise<ShipmentEvent[]> {
  const { data, error } = await supabase
    .from('shipment_events')
    .select('*')
    .eq('order_id', orderId)
    .order('event_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShipmentEvent[];
}

// ─── Customers ────────────────────────────────────────────────────────────────

export type CustomerWithCount = Customer & { order_count: number };

export async function fetchCustomers(): Promise<CustomerWithCount[]> {
  const { data: customers, error: cErr } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;
  if (!customers?.length) return [];

  const { data: counts, error: oErr } = await supabase
    .from('orders')
    .select('customer_id');
  if (oErr) throw oErr;

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    if (row.customer_id) countMap[row.customer_id] = (countMap[row.customer_id] ?? 0) + 1;
  }

  return customers.map((c) => ({
    ...(c as Customer),
    order_count: countMap[c.id] ?? 0,
  }));
}

export async function createCustomer(name: string, phone: string): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert({ name: name.trim(), phone: phone.trim() || null, source: 'manual' })
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}

// ─── Create Order ─────────────────────────────────────────────────────────────

export type NewOrderItem = {
  product_type: string;
  title: string;
  wording: string;
  qty: number;
  price: number;
};

export async function createOrder(params: {
  customerId: string;
  orderNo: string;
  deliveryMethod: string;
  items: NewOrderItem[];
}): Promise<Order> {
  const total = params.items.reduce((s, i) => s + i.qty * i.price, 0);

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .insert({
      order_no: params.orderNo,
      customer_id: params.customerId,
      delivery_method: params.deliveryMethod,
      status: 'pending',
      payment_status: 'unpaid',
      total,
    })
    .select()
    .single();
  if (oErr) throw oErr;

  const itemRows = params.items.map((i) => ({
    order_id: (order as Order).id,
    product_type: i.product_type,
    title: i.title || null,
    wording: i.wording || null,
    qty: i.qty,
    price: i.price,
  }));

  const { error: iErr } = await supabase.from('order_items').insert(itemRows);
  if (iErr) throw iErr;

  return order as Order;
}
