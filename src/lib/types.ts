export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  created_at: string;
  updated_at: string | null;
};

export type Order = {
  id: string;
  order_no: string;
  customer_id: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total: number;
  date_need: string | null;
  delivery_method: DeliveryMethod | null;
  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_postcode: string | null;
  delivery_state: string | null;
  tab: string | null;
  admin_status: string | null;
  admin_remark: string | null;
  production_approved: boolean | null;
  customer_confirmed: boolean | null;
  created_at: string;
  updated_at: string;
  customers?: Customer | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_type: string;
  title: string | null;
  wording: string | null;
  qty: number;
  price: number;
  size: string | null;
  style: string | null;
  review_required: boolean | null;
  workflow: string | null;
  design_preview_url: string | null;
  updated_at: string | null;
};

export type ProductionComponent = {
  id: string;
  order_id: string;
  order_item_id: string;
  component_type: string;
  label: string | null;
  workflow: string | null;
  review_required: boolean | null;
  review_status: string | null;
  preview_url: string | null;
  clickup_task_id: string | null;
  clickup_status: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type PaymentSession = {
  id: string;
  order_id: string;
  expected_amount: number;
  base_amount: number;
  discount: number | null;
  status: string;
  transaction_id: string | null;
  expires_at: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  submitted_at: string | null;
  matched_at: string | null;
  created_at: string;
};

export type ShipmentEvent = {
  id: string;
  shipment_id: string | null;
  order_id: string;
  event_key: string | null;
  tracking_no: string | null;
  courier: string | null;
  status: string | null;
  status_group: string | null;
  event_name: string | null;
  event_time: string | null;
  created_at: string;
};

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_production'
  | 'ready'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';
export type DeliveryMethod = 'pickup' | 'courier' | 'hand_delivery';

export type DashboardStats = {
  total: number;
  revenue: number;
  in_production: number;
  pending: number;
  byStatus: Record<string, number>;
};
