// Types mirror docs/API.md (the authoritative HTTP contract).
export type Money = string; // decimal string, e.g. "12500.00" — never a float

export type OrderStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'written_off';
export type CreditStatus = 'none' | 'pending_authorization' | 'authorized' | 'rejected' | 'not_needed';
export type PaymentMethod = 'cash' | 'transfer' | 'credit';
export type ProofStatus = 'pending_verification' | 'approved' | 'rejected' | 'refunded';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  price: Money;
  is_available: boolean;
}

export interface PublicMenu {
  business_name: string;
  accepting_orders: boolean;
  currency: string;
  products: PublicProduct[];
}

export interface PublicLimits {
  max_order_lines: number;
  max_quantity_per_line: number;
  max_proof_bytes: number;
  allowed_proof_mime_types: string[];
  max_pending_proofs_per_order: number;
}

export interface PublicSettings {
  business_name: string;
  accepting_orders: boolean;
  currency: string;
  timezone: string;
  enabled_payment_methods: PaymentMethod[];
  allow_partial_payments: boolean;
  bank_name: string | null;
  bank_account_type: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  bank_holder_id: string | null;
  transfer_instructions: string | null;
  limits: PublicLimits;
}

export interface OrderItemOut {
  product_id: string;
  product_name: string;
  unit_price: Money;
  quantity: number;
  line_total: Money;
}

export interface PublicProofOut {
  id: string;
  status: ProofStatus;
  declared_amount: Money;
  created_at: string;
  rejection_reason: string | null;
}

export interface PublicOrderOut {
  code: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  credit_status: CreditStatus;
  payment_method: PaymentMethod;
  customer_name: string;
  notes: string | null;
  items: OrderItemOut[];
  total: Money;
  amount_paid: Money;
  balance_due: Money;
  created_at: string;
  updated_at: string;
  proofs: PublicProofOut[];
  /** Sum declared by proofs still in review. Left to transfer = balance_due − pending_proofs_total. */
  pending_proofs_total: Money;
}

export interface OrderCreateBody {
  customer_name: string;
  customer_phone: string | null;
  notes: string | null;
  payment_method: PaymentMethod;
  items: OrderItemIn[];
  /** Total the customer reviewed (OrderQuoteOut.total). Mismatch → 409 price_changed. */
  expected_total?: Money;
}

export interface OrderItemIn {
  product_id: string;
  quantity: number;
}

export interface QuoteLineOut {
  product_id: string;
  product_name: string;
  unit_price: Money;
  quantity: number;
  line_total: Money;
}

export interface QuoteErrorOut {
  product_id: string;
  product_name: string | null;
  code: 'product_not_found' | 'product_unavailable';
  detail: string;
}

/** Server-calculated price of a cart (POST /public/orders/quote). Nothing is stored. */
export interface OrderQuoteOut {
  lines: QuoteLineOut[];
  errors: QuoteErrorOut[];
  total: Money;
  is_valid: boolean;
}

export interface PublicOrderCreated {
  tracking_token: string;
  order: PublicOrderOut;
}
