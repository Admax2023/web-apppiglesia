import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/ui';
import CheckoutPage from './pages/CheckoutPage';
import MenuPage from './pages/MenuPage';
import OrderPage from './pages/OrderPage';
import RecentOrdersPage from './pages/RecentOrdersPage';
import { CartProvider, CatalogProvider } from './state';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="empty-state">
      <h1 className="page-title">Página no encontrada</h1>
      <Link to="/" className="btn btn-primary">
        Ir al menú
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <CatalogProvider>
        <CartProvider>
          <ScrollToTop />
          <Layout>
            <Routes>
              <Route path="/" element={<MenuPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/pedido/:token" element={<OrderPage />} />
              <Route path="/mis-pedidos" element={<RecentOrdersPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </CartProvider>
      </CatalogProvider>
    </BrowserRouter>
  );
}
