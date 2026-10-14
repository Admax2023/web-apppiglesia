import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Spinner, Stepper } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { PAYMENT_METHOD } from '../lib/labels';
import { formatCOP } from '../lib/money';
import type { Money, OrderCreateBody, OrderItemIn, OrderQuoteOut, PaymentMethod } from '../lib/types';
import { addRecentOrder, readJSON, uuidv4, writeJSON } from '../lib/util';
import { useCart, useCartLines, useCatalog } from '../state';

const ATTEMPT_KEY = 'iglesia.checkoutAttempt.v1';
const BUYER_KEY = 'iglesia.buyer.v1';

/**
 * One Idempotency-Key per submission intent. It is kept (also across reloads, in sessionStorage) while
 * the request body stays identical, so retries after a timeout or a double tap replay the same order
 * instead of creating a new one. Any change to the cart or the form produces a new key.
 */
interface Attempt {
  key: string;
  fingerprint: string;
}

/** A server quote (or the failure to get one) for one exact cart, identified by its items key. */
interface QuoteState {
  key: string;
  data: OrderQuoteOut | null;
  error: string | null;
}

/** Shown after 409 price_changed until the customer re-confirms (or changes the cart). */
interface PriceChange {
  key: string;
  from: Money;
  to: Money;
}

const QUOTE_DEBOUNCE_MS = 300;

type FieldName = 'customer_name' | 'customer_phone' | 'notes' | 'payment_method';
type FieldErrors = Partial<Record<FieldName, string>>;

function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { menu, settings, loading, error: catalogError, reload } = useCatalog();
  const { setQuantity, clear, removeMany } = useCart();
  const { lines, unavailable, units } = useCartLines();

  const saved = readJSON<{ name?: string; phone?: string }>('local', BUYER_KEY, {});
  const [name, setName] = useState(saved.name ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [priceChange, setPriceChange] = useState<PriceChange | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const methods = useMemo(() => settings?.enabled_payment_methods ?? [], [settings]);
  useEffect(() => {
    // Preselect when there is exactly one method; drop a selection that is no longer enabled.
    if (method && !methods.includes(method)) setMethod('');
    else if (!method && methods.length === 1 && methods[0]) setMethod(methods[0]);
  }, [methods, method]);

  // Refresh the server's menu prices when the review step opens, so the total shown is current.
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  // The exact items that would be submitted; the server quote is requested for (and tied to) this key.
  const itemsKey = useMemo(
    () => JSON.stringify(lines.map((l): OrderItemIn => ({ product_id: l.product.id, quantity: l.quantity }))),
    [lines],
  );

  // Ask the server for the official price of the cart (debounced while quantities are being edited).
  useEffect(() => {
    if (itemsKey === '[]') return;
    let cancelled = false;
    const items = JSON.parse(itemsKey) as OrderItemIn[];
    const timer = window.setTimeout(() => {
      api
        .quote(items)
        .then((data) => {
          if (!cancelled) setQuote({ key: itemsKey, data, error: null });
        })
        .catch((err: unknown) => {
          if (!cancelled) setQuote({ key: itemsKey, data: null, error: errorMessage(err) });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [itemsKey, quoteNonce]);

  const current = quote && quote.key === itemsKey ? quote : null;
  const serverQuote = current?.data ?? null;
  const quoteError = current?.error ?? null;
  const quoteLoading = itemsKey !== '[]' && !current;
  const quoteLines = useMemo(
    () => new Map((serverQuote?.lines ?? []).map((l) => [l.product_id, l])),
    [serverQuote],
  );
  const activePriceChange = priceChange && priceChange.key === itemsKey ? priceChange : null;

  if (!menu || !settings) {
    if (loading) return <Spinner label="Cargando…" />;
    return (
      <Alert
        title="No pudimos cargar el menú"
        action={
          <button className="btn btn-primary" onClick={() => void reload()}>
            Reintentar
          </button>
        }
      >
        {errorMessage(catalogError)}
      </Alert>
    );
  }

  const accepting = menu.accepting_orders && settings.accepting_orders;
  const maxQty = settings.limits.max_quantity_per_line;

  if (lines.length === 0 && unavailable.length === 0) {
    return (
      <div className="empty-state">
        <h1 className="page-title">Tu pedido</h1>
        <p>Tu carrito está vacío.</p>
        <Link to="/" className="btn btn-primary">
          Ver el menú
        </Link>
      </div>
    );
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    const n = name.trim();
    if (n.length < 2) errs.customer_name = 'Escribe tu nombre (mínimo 2 letras).';
    else if (n.length > 120) errs.customer_name = 'El nombre es demasiado largo (máximo 120).';
    const p = phone.trim();
    if (p) {
      if (!/^[+\d\s().-]+$/.test(p)) errs.customer_phone = 'Usa solo números (puedes incluir +, espacios o guiones).';
      else {
        const d = phoneDigits(p);
        if (d.length < 7 || d.length > 15) errs.customer_phone = 'El teléfono debe tener entre 7 y 15 dígitos.';
      }
    }
    if (notes.trim().length > 500) errs.notes = 'Máximo 500 caracteres.';
    if (!method) errs.payment_method = 'Elige cómo vas a pagar.';
    return errs;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return; // double-submit guard
    setSubmitError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = document.getElementById(`f-${Object.keys(errs)[0]}`);
      first?.focus();
      return;
    }
    if (unavailable.length > 0 || !method) return;
    if (!serverQuote || !serverQuote.is_valid) return; // the customer must see the server total first

    const submittedKey = itemsKey;
    const expectedTotal = serverQuote.total;
    const body: OrderCreateBody = {
      customer_name: name.trim(),
      customer_phone: phone.trim() || null,
      notes: notes.trim() || null,
      payment_method: method,
      items: JSON.parse(submittedKey) as OrderItemIn[],
      expected_total: expectedTotal,
    };
    const fingerprint = JSON.stringify(body);
    let attempt = readJSON<Attempt | null>('session', ATTEMPT_KEY, null);
    if (!attempt || attempt.fingerprint !== fingerprint) {
      attempt = { key: uuidv4(), fingerprint };
      writeJSON('session', ATTEMPT_KEY, attempt);
    }

    inFlight.current = true;
    setSubmitting(true);
    setPriceChange(null);
    try {
      const res = await api.createOrder(body, attempt.key);
      writeJSON('session', ATTEMPT_KEY, null);
      writeJSON('local', BUYER_KEY, { name: body.customer_name, phone: body.customer_phone ?? '' });
      addRecentOrder({
        token: res.tracking_token,
        code: res.order.code,
        total: res.order.total,
        created_at: res.order.created_at,
      });
      clear();
      navigate(`/pedido/${encodeURIComponent(res.tracking_token)}?nuevo=1`, {
        replace: true,
        state: { order: res.order },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'price_changed' && err.quote) {
        // Nothing was created. Show the new server total and require a new confirmation; the next
        // submit carries the new expected_total and a fresh Idempotency-Key.
        writeJSON('session', ATTEMPT_KEY, null);
        setQuote({ key: submittedKey, data: err.quote, error: null });
        setPriceChange({ key: submittedKey, from: expectedTotal, to: err.quote.total });
        void reload();
        return;
      }
      if (err instanceof ApiError) {
        // The stored key can no longer be used: the next submit gets a fresh one.
        if (err.code === 'idempotency_key_conflict' || err.code === 'idempotency_replay_unavailable') {
          writeJSON('session', ATTEMPT_KEY, null);
        }
        if (err.code === 'product_unavailable' || err.code === 'product_not_found' || err.code === 'payment_method_disabled' || err.code === 'orders_closed') {
          void reload();
        }
        if (err.code === 'validation_error') {
          const fe: FieldErrors = {};
          for (const fErr of err.errors) {
            const field = fErr.loc[1];
            if (field === 'customer_name' || field === 'customer_phone' || field === 'notes' || field === 'payment_method') {
              fe[field] = fErr.msg.replace(/^Value error, /, '');
            }
          }
          setFieldErrors(fe);
        }
      }
      setSubmitError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const clearErr = (f: FieldName) =>
    setFieldErrors((prev) => {
      if (!prev[f]) return prev;
      const next = { ...prev };
      delete next[f];
      return next;
    });

  const describedBy = (f: FieldName, hint?: string) =>
    [hint, fieldErrors[f] ? `err-${f}` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <p>
        <Link to="/" className="back-link">
          ← Seguir eligiendo
        </Link>
      </p>
      <h1 className="page-title">Revisa tu pedido</h1>

      {!accepting && (
        <Alert tone="warning" title="Por ahora no estamos recibiendo pedidos">
          Intenta de nuevo más tarde.
        </Alert>
      )}

      {unavailable.length > 0 && (
        <Alert
          tone="warning"
          title="Algunos productos ya no están disponibles"
          action={
            <button type="button" className="btn btn-secondary btn-small" onClick={() => removeMany(unavailable.map((u) => u.id))}>
              Quitarlos del pedido
            </button>
          }
        >
          {unavailable.map((u) => u.name ?? 'Producto retirado del menú').join(', ')}
        </Alert>
      )}

      {serverQuote && serverQuote.errors.length > 0 && (
        <Alert
          tone="warning"
          title="Algunos productos no se pueden pedir"
          action={
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                removeMany(serverQuote.errors.map((e) => e.product_id));
                void reload();
              }}
            >
              Quitarlos del pedido
            </button>
          }
        >
          {serverQuote.errors.map((e) => e.product_name ?? 'Producto retirado del menú').join(', ')}
        </Alert>
      )}

      <section className="card" aria-labelledby="h-items">
        <h2 id="h-items" className="section-title">
          Productos ({units})
        </h2>
        <ul className="line-list">
          {lines.map((l) => {
            const ql = quoteLines.get(l.product.id);
            return (
              <li key={l.product.id} className="line">
                <div className="line-info">
                  <span className="line-name">{l.product.name}</span>
                  <span className="muted small">
                    {ql ? `${formatCOP(ql.unit_price)} c/u` : serverQuote ? 'No disponible' : 'Calculando…'}
                  </span>
                </div>
                <Stepper
                  label={l.product.name}
                  value={l.quantity}
                  max={maxQty}
                  onChange={(v) => setQuantity(l.product.id, v)}
                  disabled={submitting}
                />
                <span className="line-total">{ql ? formatCOP(ql.line_total) : '—'}</span>
              </li>
            );
          })}
        </ul>
        <div className="total-row balance" aria-live="polite">
          <span>Total calculado por el sistema</span>
          <strong>{serverQuote ? formatCOP(serverQuote.total) : quoteLoading ? 'Calculando…' : '—'}</strong>
        </div>
        {quoteError ? (
          <Alert
            title="No pudimos calcular el total"
            action={
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setQuoteNonce((n) => n + 1)}>
                Reintentar
              </button>
            }
          >
            {quoteError}
          </Alert>
        ) : (
          <p className="muted small">
            Precios y total calculados por el sistema con sus precios vigentes (no se pueden modificar aquí). Este es
            el total que se registrará: si un precio cambia antes de que envíes el pedido, te avisaremos y te
            pediremos confirmar el nuevo total.
          </p>
        )}
      </section>

      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="h-buyer">
        <h2 id="h-buyer" className="section-title">
          Tus datos
        </h2>

        <div className="field">
          <label htmlFor="f-customer_name">Nombre *</label>
          <input
            id="f-customer_name"
            name="name"
            autoComplete="name"
            value={name}
            maxLength={120}
            required
            onChange={(e) => { setName(e.target.value); clearErr('customer_name'); }}
            aria-invalid={!!fieldErrors.customer_name}
            aria-describedby={describedBy('customer_name')}
          />
          {fieldErrors.customer_name && (
            <p id="err-customer_name" className="field-error">
              {fieldErrors.customer_name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="f-customer_phone">
            Teléfono <span className="muted">(opcional)</span>
          </label>
          <input
            id="f-customer_phone"
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            maxLength={30}
            onChange={(e) => { setPhone(e.target.value); clearErr('customer_phone'); }}
            aria-invalid={!!fieldErrors.customer_phone}
            aria-describedby={describedBy('customer_phone', 'hint-phone')}
          />
          <p id="hint-phone" className="hint">
            Solo para avisarte sobre tu pedido.
          </p>
          {fieldErrors.customer_phone && (
            <p id="err-customer_phone" className="field-error">
              {fieldErrors.customer_phone}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="f-notes">
            Notas <span className="muted">(opcional)</span>
          </label>
          <textarea
            id="f-notes"
            rows={2}
            value={notes}
            maxLength={500}
            placeholder="Ej.: sin salsa"
            onChange={(e) => { setNotes(e.target.value); clearErr('notes'); }}
            aria-invalid={!!fieldErrors.notes}
            aria-describedby={describedBy('notes')}
          />
          {fieldErrors.notes && (
            <p id="err-notes" className="field-error">
              {fieldErrors.notes}
            </p>
          )}
        </div>

        <fieldset className="field" aria-describedby={fieldErrors.payment_method ? 'err-payment_method' : undefined}>
          <legend>Método de pago *</legend>
          {methods.length === 0 && <p className="muted">No hay métodos de pago habilitados en este momento.</p>}
          <div className="radio-list">
            {methods.map((m, i) => (
              <label key={m} className={`radio-card${method === m ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="payment_method"
                  id={i === 0 ? 'f-payment_method' : undefined}
                  value={m}
                  checked={method === m}
                  onChange={() => { setMethod(m); clearErr('payment_method'); }}
                />
                <span>
                  <span className="radio-title">
                    {PAYMENT_METHOD[m].label}
                    {m === 'credit' && <span className="tag-warning">Sujeto a autorización</span>}
                  </span>
                  <span className="hint">{PAYMENT_METHOD[m].help}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldErrors.payment_method && (
            <p id="err-payment_method" className="field-error">
              {fieldErrors.payment_method}
            </p>
          )}
        </fieldset>

        {activePriceChange && (
          <Alert tone="warning" title="El total de tu pedido cambió">
            Los precios cambiaron mientras revisabas tu pedido. Total anterior:{' '}
            <strong>{formatCOP(activePriceChange.from)}</strong>. Nuevo total:{' '}
            <strong>{formatCOP(activePriceChange.to)}</strong>. Revisa los productos arriba y, si estás de acuerdo,
            confirma el nuevo total. Tu pedido aún no se ha enviado.
          </Alert>
        )}

        {submitError && (
          <div ref={errorRef} tabIndex={-1}>
            <Alert title="No se pudo enviar el pedido">{submitError}</Alert>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-large btn-block"
          disabled={
            submitting ||
            !accepting ||
            unavailable.length > 0 ||
            lines.length === 0 ||
            methods.length === 0 ||
            !serverQuote ||
            !serverQuote.is_valid
          }
          aria-busy={submitting}
        >
          {submitting
            ? 'Enviando pedido…'
            : activePriceChange && serverQuote
              ? `Confirmar nuevo total (${formatCOP(serverQuote.total)}) y enviar`
              : serverQuote
                ? `Enviar pedido · ${formatCOP(serverQuote.total)}`
                : 'Enviar pedido'}
        </button>
        <p className="muted small center">Al enviar recibirás un código y un enlace para seguir tu pedido.</p>
      </form>
    </div>
  );
}
