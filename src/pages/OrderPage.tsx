import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ProofUpload from '../components/ProofUpload';
import { Alert, Badge, CopyButton, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { CREDIT_STATUS, ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, PROOF_STATUS } from '../lib/labels';
import { formatCOP, toCents } from '../lib/money';
import type { PublicOrderOut } from '../lib/types';
import { absoluteAppUrl, addRecentOrder, formatDateTime, removeRecentOrder } from '../lib/util';
import { useCatalog } from '../state';

const POLL_MS = 15_000;

export default function OrderPage() {
  const { token = '' } = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useCatalog();
  const initial = (location.state as { order?: PublicOrderOut } | null)?.order ?? null;
  const isNew = search.get('nuevo') === '1';

  const [order, setOrder] = useState<PublicOrderOut | null>(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initial ? new Date() : null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current || !token) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const o = await api.order(token);
      setOrder(o);
      setError(null);
      setLastUpdate(new Date());
      addRecentOrder({ token, code: o.code, total: o.total, created_at: o.created_at });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)));
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [token]);

  // Initial load + polling every ~15 s while the tab is visible.
  useEffect(() => {
    if (!initial) void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (!order) {
    if (error?.code === 'order_not_found') {
      return (
        <div className="empty-state">
          <h1 className="page-title">Pedido no encontrado</h1>
          <Alert tone="warning">
            No encontramos un pedido con este enlace. Verifica que lo hayas copiado completo.
          </Alert>
          <button
            className="btn btn-secondary"
            onClick={() => {
              removeRecentOrder(token);
              navigate('/mis-pedidos');
            }}
          >
            Quitar de “Mis pedidos”
          </button>{' '}
          <Link to="/" className="btn btn-primary">
            Ir al menú
          </Link>
        </div>
      );
    }
    if (error) {
      return (
        <Alert
          title="No pudimos cargar tu pedido"
          action={
            <button className="btn btn-primary" onClick={() => void load()} disabled={refreshing}>
              Reintentar
            </button>
          }
        >
          {errorMessage(error)}
        </Alert>
      );
    }
    return <Spinner label="Cargando tu pedido…" />;
  }

  const tz = settings?.timezone;
  const status = ORDER_STATUS[order.status];
  const pay = PAYMENT_STATUS[order.payment_status];
  const credit = CREDIT_STATUS[order.credit_status];
  const balanceCents = toCents(order.balance_due);
  const cancelled = order.status === 'cancelled';
  // The server accepts proofs for transfer orders even if transfer is later disabled for new orders.
  const transferEnabled =
    order.payment_method === 'transfer' || (settings?.enabled_payment_methods.includes('transfer') ?? false);
  const canPayByTransfer = !cancelled && balanceCents > 0n && transferEnabled;
  const trackingUrl = absoluteAppUrl(`/pedido/${encodeURIComponent(token)}`);
  const pendingProofs = order.proofs.filter((p) => p.status === 'pending_verification');
  // Authoritative sum from the server; what is left to transfer = balance_due − pending_proofs_total.
  const pendingCents = toCents(order.pending_proofs_total);
  const toTransferCents = balanceCents - pendingCents > 0n ? balanceCents - pendingCents : 0n;

  return (
    <div>
      {isNew && (
        <section className="card confirm-card" aria-labelledby="h-confirm">
          <h1 id="h-confirm" className="page-title">
            ¡Pedido recibido!
          </h1>
          <p>Tu código de pedido es:</p>
          <p className="order-code" aria-label={`Código ${order.code.split('').join(' ')}`}>
            {order.code}
          </p>
          <p>
            Total calculado por el sistema: <strong className="big-amount">{formatCOP(order.total)}</strong>
          </p>
          <Alert tone="warning" title="Guarda este enlace">
            Es la única forma de consultar tu pedido y enviar el comprobante de pago. Guárdalo (cópialo o toma
            una captura de pantalla). También lo dejamos guardado en “Mis pedidos” de este teléfono.
          </Alert>
        </section>
      )}

      <section className="card" aria-labelledby="h-status">
        <div className="status-head">
          <h2 id="h-status" className="section-title">
            Pedido <span className="mono">{order.code}</span>
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => void load()}
            disabled={refreshing}
            aria-label="Actualizar estado del pedido"
          >
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
        <p className="muted small">
          {order.customer_name} · {formatDateTime(order.created_at, tz)}
        </p>

        <dl className="status-grid">
          <div>
            <dt>Estado del pedido</dt>
            <dd>
              <Badge tone={status.tone}>{status.label}</Badge>
            </dd>
          </div>
          <div>
            <dt>Estado del pago</dt>
            <dd>
              <Badge tone={pay.tone}>{pay.label}</Badge>
            </dd>
          </div>
          <div>
            <dt>Método de pago</dt>
            <dd>{PAYMENT_METHOD[order.payment_method].label}</dd>
          </div>
          {credit && (
            <div>
              <dt>Fiado</dt>
              <dd>
                <Badge tone={credit.tone}>{credit.label}</Badge>
              </dd>
            </div>
          )}
        </dl>
        <p className="status-help" aria-live="polite">
          {status.help}
        </p>

        <div aria-live="polite">
          {error && (
            <p className="field-error small">No se pudo actualizar: {errorMessage(error)}</p>
          )}
          {lastUpdate && (
            <p className="muted small">
              Se actualiza solo cada 15 segundos · última vez{' '}
              {lastUpdate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="h-detail">
        <h2 id="h-detail" className="section-title">
          Detalle
        </h2>
        <ul className="line-list">
          {order.items.map((it) => (
            <li key={it.product_id} className="line line-static">
              <div className="line-info">
                <span className="line-name">
                  {it.quantity} × {it.product_name}
                </span>
                <span className="muted small">{formatCOP(it.unit_price)} c/u</span>
              </div>
              <span className="line-total">{formatCOP(it.line_total)}</span>
            </li>
          ))}
        </ul>
        {order.notes && <p className="small">Notas: {order.notes}</p>}
        <dl className="totals">
          <div className="total-row">
            <dt>Total</dt>
            <dd>{formatCOP(order.total)}</dd>
          </div>
          <div className="total-row">
            <dt>Pagado</dt>
            <dd>{formatCOP(order.amount_paid)}</dd>
          </div>
          <div className="total-row balance">
            <dt>Saldo pendiente</dt>
            <dd>{formatCOP(order.balance_due)}</dd>
          </div>
          {pendingCents > 0n && !cancelled && (
            <>
              <div className="total-row">
                <dt>Comprobantes en verificación</dt>
                <dd>{formatCOP(pendingCents)}</dd>
              </div>
              <div className="total-row">
                <dt>Falta por transferir</dt>
                <dd>{formatCOP(toTransferCents)}</dd>
              </div>
            </>
          )}
        </dl>
        {order.payment_method === 'cash' && balanceCents > 0n && !cancelled && (
          <p className="muted small">Paga en efectivo al recoger. El pago se registra cuando lo recibimos.</p>
        )}
        {order.payment_method === 'credit' && order.credit_status === 'pending_authorization' && (
          <p className="muted small">El fiado está sujeto a autorización del administrador.</p>
        )}
      </section>

      {canPayByTransfer && settings && (
        <section className="card" aria-labelledby="h-transfer">
          {order.payment_method === 'transfer' ? (
            <>
              <h2 id="h-transfer" className="section-title">
                Pago por transferencia
              </h2>
              <TransferDetails order={order} toTransferCents={toTransferCents} pendingCents={pendingCents} />
              <ProofUpload
                token={token}
                order={order}
                settings={settings}
                pendingCount={pendingProofs.length}
                pendingCents={pendingCents}
                onUploaded={() => void load()}
              />
            </>
          ) : (
            <details>
              <summary id="h-transfer" className="section-title summary">
                ¿Prefieres pagar por transferencia?
              </summary>
              <TransferDetails order={order} toTransferCents={toTransferCents} pendingCents={pendingCents} />
              <ProofUpload
                token={token}
                order={order}
                settings={settings}
                pendingCount={pendingProofs.length}
                pendingCents={pendingCents}
                onUploaded={() => void load()}
              />
            </details>
          )}
        </section>
      )}

      {order.proofs.length > 0 && (
        <section className="card" aria-labelledby="h-proofs">
          <h2 id="h-proofs" className="section-title">
            Comprobantes enviados
          </h2>
          <ul className="proof-list">
            {order.proofs.map((p) => {
              const ps = PROOF_STATUS[p.status];
              return (
                <li key={p.id} className="proof-item">
                  <div>
                    <strong>{formatCOP(p.declared_amount)}</strong>
                    <span className="muted small"> · {formatDateTime(p.created_at, tz)}</span>
                    {p.rejection_reason && <p className="small field-error">Motivo: {p.rejection_reason}</p>}
                  </div>
                  <Badge tone={ps.tone}>{ps.label}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Enviar el comprobante no confirma el pago: lo verificamos y luego lo aprobamos.
          </p>
        </section>
      )}
      {order.payment_method === 'transfer' && order.proofs.length === 0 && !cancelled && balanceCents > 0n && (
        <p className="muted small center">Comprobante: sin comprobante todavía.</p>
      )}

      {!isNew && (
        <section className="card" aria-labelledby="h-link">
          <h2 id="h-link" className="section-title">
            Enlace de seguimiento
          </h2>
          <p className="small">Guárdalo: es la única forma de consultar este pedido.</p>
          <div className="link-box">
            <code className="tracking-url">{trackingUrl}</code>
            <CopyButton text={trackingUrl} label="Copiar enlace" />
          </div>
        </section>
      )}

      <p className="center">
        <Link to="/" className="btn btn-secondary">
          Hacer otro pedido
        </Link>
      </p>
    </div>
  );
}

function TransferDetails({
  order,
  toTransferCents,
  pendingCents,
}: {
  order: PublicOrderOut;
  toTransferCents: bigint;
  pendingCents: bigint;
}) {
  const { settings } = useCatalog();
  if (!settings) return null;
  const rows: [string, string | null][] = [
    ['Banco', settings.bank_name],
    ['Tipo de cuenta', settings.bank_account_type],
    ['Número de cuenta', settings.bank_account_number],
    ['Titular', settings.bank_account_holder],
    ['Documento del titular', settings.bank_holder_id],
  ];
  const valid = rows.filter((r): r is [string, string] => !!r[1]);
  return (
    <div className="bank-box">
      <p>
        Valor a transferir: <strong className="big-amount">{formatCOP(toTransferCents)}</strong>
      </p>
      {pendingCents > 0n && (
        <p className="small muted">
          Saldo pendiente {formatCOP(order.balance_due)} menos {formatCOP(pendingCents)} en comprobantes que estamos
          verificando.
        </p>
      )}
      {valid.length > 0 ? (
        <dl className="bank-details">
          {valid.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                <span className={k === 'Número de cuenta' ? 'mono' : undefined}>{v}</span>
                {k === 'Número de cuenta' && <CopyButton text={v} label="Copiar" />}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">Pide los datos bancarios en el punto de venta.</p>
      )}
      {settings.transfer_instructions && <p className="small pre-line">{settings.transfer_instructions}</p>}
      <p className="small">
        Incluye el código <strong className="mono">{order.code}</strong> en la descripción de la transferencia si tu
        banco lo permite.
      </p>
    </div>
  );
}
