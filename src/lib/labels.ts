import type { CreditStatus, OrderStatus, PaymentMethod, PaymentStatus, ProofStatus } from './types';

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone; help: string }> = {
  pending_confirmation: {
    label: 'Pendiente de confirmación',
    tone: 'warning',
    help: 'Recibimos tu pedido; pronto lo confirmaremos.',
  },
  confirmed: { label: 'Confirmado', tone: 'info', help: 'Tu pedido fue confirmado.' },
  preparing: { label: 'En preparación', tone: 'progress', help: 'Estamos preparando tu pedido.' },
  ready: { label: 'Listo para entregar', tone: 'success', help: '¡Tu pedido está listo! Puedes pasar a recogerlo.' },
  delivered: { label: 'Entregado', tone: 'neutral', help: 'Pedido entregado. ¡Gracias!' },
  cancelled: { label: 'Cancelado', tone: 'danger', help: 'Este pedido fue cancelado.' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  unpaid: { label: 'Sin pagar', tone: 'warning' },
  partial: { label: 'Pago parcial', tone: 'info' },
  paid: { label: 'Pagado', tone: 'success' },
  refunded: { label: 'Reembolsado', tone: 'neutral' },
  written_off: { label: 'Saldo condonado', tone: 'neutral' },
};

export const CREDIT_STATUS: Record<CreditStatus, { label: string; tone: Tone } | null> = {
  none: null,
  pending_authorization: { label: 'Fiado pendiente de autorización', tone: 'warning' },
  authorized: { label: 'Fiado autorizado', tone: 'success' },
  rejected: { label: 'Fiado no autorizado', tone: 'danger' },
  not_needed: { label: 'Fiado no necesario (pagado)', tone: 'neutral' },
};

export const PAYMENT_METHOD: Record<PaymentMethod, { label: string; help: string }> = {
  cash: { label: 'Efectivo', help: 'Pagas en efectivo al recoger tu pedido.' },
  transfer: {
    label: 'Transferencia bancaria',
    help: 'Te mostraremos los datos bancarios y podrás subir el comprobante.',
  },
  credit: { label: 'Crédito', help: 'Sujeto a autorización del administrador.' },
};

export const PROOF_STATUS: Record<ProofStatus, { label: string; tone: Tone }> = {
  pending_verification: { label: 'Pendiente de verificación', tone: 'warning' },
  approved: { label: 'Aprobado', tone: 'success' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  refunded: { label: 'Reembolsado', tone: 'neutral' },
};
