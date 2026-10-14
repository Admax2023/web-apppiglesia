import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../lib/labels';
import { useCatalog } from '../state';

export function Layout({ children }: { children: ReactNode }) {
  const { settings, menu } = useCatalog();
  const name = settings?.business_name || menu?.business_name || 'Menú';
  return (
    <>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {name}
          </Link>
          <nav aria-label="Principal">
            <Link to="/mis-pedidos" className="nav-link">
              Mis pedidos
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="container main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({
  tone = 'danger',
  title,
  children,
  action,
}: {
  tone?: 'danger' | 'warning' | 'info' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="alert-title">{title}</p>}
      {children && <div>{children}</div>}
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
  disabled,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Quitar uno: ${label}`}
      >
        −
      </button>
      <output className="stepper-value" aria-live="polite" aria-label={`Cantidad de ${label}`}>
        {value}
      </output>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Agregar uno: ${label}`}
      >
        +
      </button>
    </div>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // Fallback for plain-http LAN access
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    setState(ok ? 'ok' : 'fail');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2500);
  }
  return (
    <button type="button" className="btn btn-secondary btn-small" onClick={() => void copy()}>
      <span aria-live="polite">{state === 'ok' ? '¡Copiado!' : state === 'fail' ? 'No se pudo copiar' : label}</span>
    </button>
  );
}
