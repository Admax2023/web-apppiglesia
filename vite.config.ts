import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: requests to /api are proxied to the FastAPI backend (no CORS needed).
// Override the target with VITE_DEV_PROXY_TARGET if the backend runs elsewhere.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // 127.0.0.1, not "localhost": Node may resolve localhost to ::1 while uvicorn listens on IPv4 only.
  const target = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000';
  const apiProxy: Record<string, ProxyOptions> = {
    '/api': {
      target,
      changeOrigin: false,
      // Backend down → answer 503 in the API error format instead of a raw ECONNREFUSED.
      configure: (proxy) => {
        proxy.on('error', (err, _req, res) => {
          console.error(`[api proxy] ${target} no responde (${(err as NodeJS.ErrnoException).code ?? err.message}). ¿Está corriendo el backend?`);
          if ('writeHead' in res && !res.headersSent) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'El servidor no está disponible en este momento. Intenta de nuevo en unos minutos.', code: 'backend_unavailable' }));
          }
        });
      },
    },
  };
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: apiProxy,
    },
    preview: {
      host: true,
      port: 4173,
      proxy: apiProxy,
    },
    build: {
      target: 'es2020',
      sourcemap: false,
    },
  };
});
