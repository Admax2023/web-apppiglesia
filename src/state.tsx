import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './lib/api';
import { toCents } from './lib/money';
import type { PublicMenu, PublicProduct, PublicSettings } from './lib/types';
import { readJSON, writeJSON } from './lib/util';

// ---------------------------------------------------------------- catalog (menu + public settings)

interface CatalogState {
  menu: PublicMenu | null;
  settings: PublicSettings | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

const CatalogCtx = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([api.menu(), api.settings()]);
      setMenu(m);
      setSettings(s);
      setError(null);
      if (s.business_name) document.title = `${s.business_name} — Menú`;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ menu, settings, loading, error, reload }), [menu, settings, loading, error, reload]);
  return <CatalogCtx.Provider value={value}>{children}</CatalogCtx.Provider>;
}

export function useCatalog(): CatalogState {
  const v = useContext(CatalogCtx);
  if (!v) throw new Error('CatalogProvider missing');
  return v;
}

// ---------------------------------------------------------------- cart

export type CartQuantities = Record<string, number>; // product_id -> quantity

export interface CartLine {
  product: PublicProduct;
  quantity: number;
  lineCents: bigint; // estimate only — the server computes the real total
}

interface CartState {
  quantities: CartQuantities;
  setQuantity: (productId: string, qty: number) => void;
  clear: () => void;
  removeMany: (productIds: string[]) => void;
}

const CART_KEY = 'iglesia.cart.v1';
const CartCtx = createContext<CartState | null>(null);

function sanitizeCart(raw: unknown): CartQuantities {
  const out: CartQuantities = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[k] = v;
    }
  }
  return out;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [quantities, setQuantities] = useState<CartQuantities>(() => sanitizeCart(readJSON('local', CART_KEY, {})));

  useEffect(() => {
    writeJSON('local', CART_KEY, Object.keys(quantities).length ? quantities : null);
  }, [quantities]);

  const setQuantity = useCallback((productId: string, qty: number) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  }, []);

  const clear = useCallback(() => setQuantities({}), []);
  const removeMany = useCallback((ids: string[]) => {
    setQuantities((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }, []);

  const value = useMemo(() => ({ quantities, setQuantity, clear, removeMany }), [quantities, setQuantity, clear, removeMany]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): CartState {
  const v = useContext(CartCtx);
  if (!v) throw new Error('CartProvider missing');
  return v;
}

/** Joins the cart with the current menu. Lines whose product vanished or sold out are reported apart. */
export function useCartLines() {
  const { quantities } = useCart();
  const { menu } = useCatalog();
  return useMemo(() => {
    const byId = new Map((menu?.products ?? []).map((p) => [p.id, p]));
    const lines: CartLine[] = [];
    const unavailable: { id: string; name: string | null }[] = [];
    let units = 0;
    let estimateCents = 0n;
    for (const [id, qty] of Object.entries(quantities)) {
      const p = byId.get(id);
      if (!p || !p.is_available) {
        unavailable.push({ id, name: p?.name ?? null });
        continue;
      }
      const lineCents = toCents(p.price) * BigInt(qty);
      lines.push({ product: p, quantity: qty, lineCents });
      units += qty;
      estimateCents += lineCents;
    }
    // keep menu order
    const order = new Map((menu?.products ?? []).map((p, i) => [p.id, i]));
    lines.sort((a, b) => (order.get(a.product.id) ?? 0) - (order.get(b.product.id) ?? 0));
    return { lines, unavailable, units, estimateCents };
  }, [quantities, menu]);
}
