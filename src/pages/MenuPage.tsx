import { Link } from 'react-router-dom';
import { Alert, Spinner, Stepper } from '../components/ui';
import { errorMessage } from '../lib/api';
import { formatCOP } from '../lib/money';
import { useCart, useCartLines, useCatalog } from '../state';

export default function MenuPage() {
  const { menu, settings, loading, error, reload } = useCatalog();
  const { quantities, setQuantity } = useCart();
  const { lines, units, estimateCents } = useCartLines();

  if (!menu) {
    if (loading) return <Spinner label="Cargando el menú…" />;
    return (
      <Alert
        title="No pudimos cargar el menú"
        action={
          <button className="btn btn-primary" onClick={() => void reload()}>
            Reintentar
          </button>
        }
      >
        {errorMessage(error)}
      </Alert>
    );
  }

  const maxQty = settings?.limits.max_quantity_per_line ?? 50;
  const maxLines = settings?.limits.max_order_lines ?? 30;
  const accepting = menu.accepting_orders && (settings?.accepting_orders ?? true);
  const linesFull = lines.length >= maxLines;

  return (
    <div className={units > 0 ? 'with-cart-bar' : undefined}>
      <h1 className="page-title">Menú</h1>
      {!accepting && (
        <Alert tone="warning" title="Por ahora no estamos recibiendo pedidos">
          Puedes ver el menú, pero no es posible enviar pedidos en este momento.
        </Alert>
      )}
      {error && (
        <Alert tone="warning" action={<button className="btn btn-secondary btn-small" onClick={() => void reload()}>Reintentar</button>}>
          No pudimos actualizar el menú: {errorMessage(error)}
        </Alert>
      )}

      {menu.products.length === 0 ? (
        <p className="muted">Todavía no hay productos en el menú.</p>
      ) : (
        <ul className="product-list">
          {menu.products.map((p) => {
            const qty = quantities[p.id] ?? 0;
            const soldOut = !p.is_available;
            return (
              <li key={p.id} className={`product-card${soldOut ? ' is-sold-out' : ''}${qty > 0 ? ' in-cart' : ''}`}>
                <div className="product-info">
                  <h2 className="product-name">{p.name}</h2>
                  {p.description && <p className="product-desc">{p.description}</p>}
                  <p className="product-price">
                    {formatCOP(p.price)}
                    {soldOut && <span className="sold-out-tag">Agotado</span>}
                  </p>
                </div>
                <div className="product-actions">
                  {soldOut ? null : qty === 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!accepting || linesFull}
                      onClick={() => setQuantity(p.id, 1)}
                      aria-label={`Agregar ${p.name}`}
                    >
                      Agregar
                    </button>
                  ) : (
                    <Stepper label={p.name} value={qty} max={maxQty} onChange={(v) => setQuantity(p.id, v)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {linesFull && <p className="muted small">Máximo {maxLines} productos distintos por pedido.</p>}

      {units > 0 && (
        <div className="cart-bar" role="region" aria-label="Resumen del carrito">
          <div className="container cart-bar-inner">
            <div aria-live="polite">
              <strong>
                {units} {units === 1 ? 'producto' : 'productos'}
              </strong>
              <span className="cart-bar-total">
                Subtotal estimado: <strong>{formatCOP(estimateCents)}</strong>
              </span>
            </div>
            {accepting ? (
              <Link to="/checkout" className="btn btn-primary btn-large">
                Revisar pedido
              </Link>
            ) : (
              <span className="muted small">Pedidos cerrados</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
