import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCOP } from '../lib/money';
import { formatDateTime, getRecentOrders, removeRecentOrder } from '../lib/util';
import { useCatalog } from '../state';

export default function RecentOrdersPage() {
  const { settings } = useCatalog();
  const [orders, setOrders] = useState(getRecentOrders);

  return (
    <div>
      <h1 className="page-title">Mis pedidos</h1>
      <p className="muted small">
        Pedidos hechos desde este teléfono o computador. Si borras los datos del navegador se pierde esta lista:
        guarda el enlace de cada pedido.
      </p>
      {orders.length === 0 ? (
        <div className="empty-state">
          <p>No tienes pedidos guardados en este dispositivo.</p>
          <Link to="/" className="btn btn-primary">
            Ver el menú
          </Link>
        </div>
      ) : (
        <ul className="recent-list">
          {orders.map((o) => (
            <li key={o.token} className="card recent-item">
              <Link to={`/pedido/${encodeURIComponent(o.token)}`} className="recent-link">
                <span className="mono strong">{o.code}</span>
                <span className="muted small">{formatDateTime(o.created_at, settings?.timezone)}</span>
                <span>{formatCOP(o.total)}</span>
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  removeRecentOrder(o.token);
                  setOrders(getRecentOrders());
                }}
                aria-label={`Quitar el pedido ${o.code} de esta lista`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
