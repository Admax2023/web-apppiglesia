# Web de pedidos (clientes)

React 18 + TypeScript (strict) + Vite. CSS plano, sin framework de UI. Consume solo la API pública
descrita en `../docs/API.md` (`/api/public/...`).

## Rutas

| Ruta | Contenido |
|---|---|
| `/` | Menú público (URL que va en el QR): productos disponibles, precios, botones +/−, barra de carrito con subtotal **estimado**. |
| `/checkout` | Revisión de líneas, nombre, teléfono (opcional), notas, método de pago (solo los de `enabled_payment_methods`; fiado muestra "Sujeto a autorización"). |
| `/pedido/:token` | Estado del pedido y del pago (insignias independientes), detalle, saldo pendiente, datos bancarios, subida de comprobante y lista de comprobantes. Se actualiza cada 15 s mientras la pestaña está visible. Con `?nuevo=1` muestra la confirmación (código + enlace para guardar). |
| `/mis-pedidos` | Pedidos hechos desde este dispositivo (tokens guardados en `localStorage`). |

## Decisiones

- **Total:** la API no tiene endpoint de cotización. El carrito muestra un "Subtotal estimado" (calculado en
  centavos con `bigint`, nunca `float`) y la confirmación muestra el `total` devuelto por el servidor.
- **Idempotencia:** al enviar se genera un UUID `Idempotency-Key` asociado a la huella del cuerpo; se guarda en
  `sessionStorage` y se reutiliza en reintentos (timeout, red, recarga) mientras el pedido no cambie. Cualquier
  cambio del carrito o del formulario genera una clave nueva. El botón se desactiva durante el envío.
- **Token de seguimiento:** se entrega una sola vez; se guarda en `localStorage` (`iglesia.recentOrders.v1`) y se
  pide al cliente guardar el enlace. `<meta name="referrer" content="no-referrer">` evita filtrarlo.
- **Comprobante:** validación previa de tipo real (bytes mágicos JPEG/PNG/WEBP), tamaño ≤ `max_proof_bytes`,
  vista previa; el nombre del archivo se ajusta a la extensión real. El servidor vuelve a validar todo.
  Si no se permiten pagos parciales (y no hay fiado autorizado) el valor declarado es exactamente el saldo.
- **Errores:** se ramifica por `code` de la API (red/timeout, 409 `duplicate_order` / `idempotency_key_conflict`,
  422 de validación con errores por campo, 429 con `Retry-After`, etc.).

## Desarrollo

```bash
cd web
npm install
cp .env.example .env      # opcional
npm run dev               # http://localhost:5173 ; /api se redirige a http://localhost:8000
```

El backend debe estar corriendo (`uvicorn app.main:app --port 8000` en `backend/`). Para probar desde un
teléfono en la misma red usa `http://<IP-del-PC>:5173` (Vite escucha en todas las interfaces).

Scripts: `npm run build` (tsc estricto + build), `npm run lint`, `npm run typecheck`, `npm run preview`
(sirve `dist/` en el puerto 4173 con el mismo proxy `/api`).

## Variables

| Variable | Defecto | Uso |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base de la API vista por el navegador. Se fija **en tiempo de build**. |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:8000` | Solo `dev`/`preview`: destino del proxy `/api`. |

## Despliegue como archivos estáticos

```bash
npm ci && npm run build   # genera web/dist/
```

`dist/` es estático: súbelo a cualquier servidor (Nginx, Caddy, hosting estático). Requisitos:

1. **Fallback SPA:** toda ruta desconocida debe servir `index.html` (para `/checkout`, `/pedido/<token>`…).
2. **Misma origen (recomendado):** publicar la web y la API bajo el mismo dominio, con `/api` redirigido al
   backend. Así no hace falta CORS. Si la API está en otro dominio, compila con
   `VITE_API_BASE_URL=https://api.ejemplo.org/api` y agrega el origen de la web a `CORS_ORIGINS` del backend.
3. **HTTPS** en producción (el token de seguimiento viaja en la URL).
4. No registrar la ruta completa `/pedido/...` en los logs de acceso si es posible (contiene el token).

Ejemplo Nginx:

```nginx
server {
  listen 443 ssl;
  server_name pedidos.ejemplo.org;
  root /var/www/iglesia-web/dist;

  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # y TRUST_PROXY_HEADERS=true en el backend
    client_max_body_size 6m;
  }
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }
}
```

## URL pública del menú (QR)

La URL del QR es la raíz de la web, p. ej. `https://pedidos.ejemplo.org/` (en el backend: `PUBLIC_WEB_URL`).
Genera el QR con cualquier generador apuntando a esa URL exacta (con `https://`), imprímelo en tamaño mínimo
3 × 3 cm y pruébalo con varios teléfonos antes de publicarlo.
