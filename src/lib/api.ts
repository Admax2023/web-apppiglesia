import type {
  OrderCreateBody,
  OrderItemIn,
  OrderQuoteOut,
  PublicMenu,
  PublicOrderCreated,
  PublicOrderOut,
  PublicProofOut,
  PublicSettings,
} from './types';

/** API base (no trailing slash). Default "/api": same origin, proxied by Vite in development. */
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api').replace(/\/+$/, '');

const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 90_000;

export interface FieldError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export class ApiError extends Error {
  readonly status: number; // 0 = network error / timeout
  readonly code: string;
  readonly detail: string;
  readonly retryAfter: number | null;
  readonly errors: FieldError[];
  /** Current server quote, only on 409 price_changed. */
  readonly quote: OrderQuoteOut | null;

  constructor(
    status: number,
    code: string,
    detail: string,
    retryAfter: number | null = null,
    errors: FieldError[] = [],
    quote: OrderQuoteOut | null = null,
  ) {
    super(detail);
    this.quote = quote;
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfter = retryAfter;
    this.errors = errors;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    throw new ApiError(
      0,
      aborted ? 'timeout' : 'network_error',
      aborted
        ? 'El servidor tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.'
        : 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
    );
  } finally {
    window.clearTimeout(timer);
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'http_error';
  let detail = `Error del servidor (${res.status}).`;
  let errors: FieldError[] = [];
  let quote: OrderQuoteOut | null = null;
  try {
    const body = (await res.json()) as { code?: unknown; detail?: unknown; errors?: unknown; quote?: unknown };
    if (typeof body.code === 'string') code = body.code;
    if (typeof body.detail === 'string') detail = body.detail;
    if (Array.isArray(body.errors)) errors = body.errors as FieldError[];
    if (body.quote && typeof body.quote === 'object') quote = body.quote as OrderQuoteOut;
  } catch {
    /* non-JSON error (proxy, gateway) */
  }
  const ra = Number(res.headers.get('Retry-After'));
  throw new ApiError(res.status, code, detail, Number.isFinite(ra) && ra > 0 ? ra : null, errors, quote);
}

export const api = {
  menu: () => request<PublicMenu>('/public/menu'),
  settings: () => request<PublicSettings>('/public/settings'),
  quote: (items: OrderItemIn[]) =>
    request<OrderQuoteOut>('/public/orders/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }),
  createOrder: (body: OrderCreateBody, idempotencyKey: string) =>
    request<PublicOrderCreated>('/public/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  order: (token: string) => request<PublicOrderOut>(`/public/orders/${encodeURIComponent(token)}`),
  uploadProof: (token: string, file: File, declaredAmount: string) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('declared_amount', declaredAmount);
    return request<PublicProofOut>(`/public/orders/${encodeURIComponent(token)}/proofs`, {
      method: 'POST',
      body: fd,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
};

/** Customer-friendly Spanish message for an error, by stable `code` (falls back to server `detail`). */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  switch (err.code) {
    case 'network_error':
    case 'timeout':
      return err.detail;
    case 'rate_limited':
      return `Hiciste demasiados intentos seguidos. Espera ${err.retryAfter ? formatWait(err.retryAfter) : 'unos minutos'} y vuelve a intentarlo.`;
    case 'orders_closed':
      return 'En este momento no estamos recibiendo pedidos.';
    case 'duplicate_order':
      return 'Ya recibimos un pedido idéntico hace un momento. Revisa “Mis pedidos” antes de enviarlo otra vez.';
    case 'idempotency_key_conflict':
      return 'Tu pedido cambió mientras se enviaba. Revisa los datos y pulsa “Enviar pedido” de nuevo.';
    case 'idempotency_in_progress':
      return 'Tu pedido todavía se está procesando. Espera unos segundos e inténtalo de nuevo.';
    case 'payment_method_disabled':
      return 'Ese método de pago ya no está disponible. Elige otro.';
    case 'product_unavailable':
      return 'Uno de los productos se agotó. Actualizamos el menú; revisa tu pedido.';
    case 'product_not_found':
      return 'Uno de los productos ya no está en el menú. Actualizamos el menú; revisa tu pedido.';
    case 'price_changed':
      return 'Los precios cambiaron desde que revisaste tu pedido. Revisa el nuevo total y confirma de nuevo.';
    case 'quantity_limit':
      return err.detail || 'Superaste la cantidad máxima permitida.';
    case 'order_not_found':
      return 'No encontramos ese pedido. Verifica que el enlace esté completo.';
    case 'payload_too_large':
    case 'file_too_large':
      return 'El archivo es demasiado grande (máximo 5 MB).';
    case 'unsupported_file_type':
    case 'file_type_mismatch':
    case 'invalid_image':
      return 'El archivo no es una imagen válida JPG, PNG o WEBP. Toma una captura de pantalla del comprobante e inténtalo de nuevo.';
    case 'too_many_pending_proofs':
      return 'Ya tienes comprobantes pendientes de verificación. Espera a que los revisemos.';
    case 'order_already_paid':
      return 'Este pedido ya está pagado.';
    case 'order_cancelled':
      return 'Este pedido fue cancelado.';
    case 'transfer_not_enabled':
      return 'Los pagos por transferencia no están habilitados en este momento.';
    case 'amount_exceeds_balance':
      return 'El valor declarado es mayor que lo que falta por transferir (el saldo pendiente menos los comprobantes que ya estamos verificando).';
    case 'pending_proofs_cover_balance':
      return 'Los comprobantes que enviaste y estamos verificando ya cubren el saldo. Espera a que los revisemos.';
    case 'amount_too_large':
      return 'El total del pedido supera el máximo permitido. Reduce las cantidades o divide el pedido.';
    case 'idempotency_replay_unavailable':
      return 'No pudimos recuperar tu envío anterior. Es posible que el pedido ya se haya registrado: pregunta en el punto de venta antes de pulsar “Enviar pedido” de nuevo.';
    case 'partial_payments_not_allowed':
      return 'No se permiten pagos parciales: el valor debe ser igual al saldo pendiente.';
    case 'spam_detected':
      return 'No pudimos procesar tu pedido. Recarga la página e inténtalo de nuevo.';
    case 'validation_error':
      return 'Hay datos inválidos. Revisa el formulario.';
    default:
      if (err.status >= 500) return 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.';
      return err.detail;
  }
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const m = Math.ceil(seconds / 60);
  return m === 1 ? '1 minuto' : `${m} minutos`;
}
