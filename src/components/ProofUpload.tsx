import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatCOP, fromCents, parseUserAmount, toCents } from '../lib/money';
import type { PublicOrderOut, PublicSettings } from '../lib/types';
import { Alert } from './ui';

type Kind = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: string };

/** Detects the real image type from the first bytes (the server verifies again and decodes it). */
async function sniffImage(file: File): Promise<Kind | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  )
    return { mime: 'image/png', ext: 'png' };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

interface Props {
  token: string;
  order: PublicOrderOut;
  settings: PublicSettings;
  pendingCount: number;
  pendingCents: bigint;
  onUploaded: () => void;
}

export default function ProofUpload({ token, order, settings, pendingCount, pendingCents, onUploaded }: Props) {
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const balanceCents = toCents(order.balance_due);
  // Same rule as the server: partial settings, authorized credit, or a debt (delivered with balance).
  const isDebt = order.status === 'delivered' && balanceCents > 0n;
  const partialAllowed = settings.allow_partial_payments || order.credit_status === 'authorized' || isDebt;
  // Proofs still in review already claim part of the balance (server: balance_due − pending_proofs_total).
  const remainingCents = balanceCents - pendingCents > 0n ? balanceCents - pendingCents : 0n;
  const maxBytes = settings.limits.max_proof_bytes;
  const maxPending = settings.limits.max_pending_proofs_per_order;

  const suggested = remainingCents;
  const [amountText, setAmountText] = useState(() =>
    suggested % 100n === 0n ? (suggested / 100n).toString() : fromCents(suggested).replace('.', ','),
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  if (pendingCount >= maxPending) {
    return (
      <Alert tone="info" title="Comprobantes en verificación">
        Ya enviaste {pendingCount} comprobantes que estamos verificando. Espera a que los revisemos antes de enviar
        otro.
      </Alert>
    );
  }

  if (remainingCents <= 0n || (!partialAllowed && pendingCents > 0n)) {
    return (
      <Alert tone="info" title="Comprobante en verificación">
        Los comprobantes que enviaste ({formatCOP(pendingCents)}) ya cubren el saldo pendiente. Espera a que los
        revisemos; si alguno se rechaza, podrás enviar otro aquí.
      </Alert>
    );
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    setSubmitError(null);
    setSent(false);
    const f = e.target.files?.[0] ?? null;
    setFile(null);
    setPreview(null);
    if (!f) return;
    if (f.size === 0) {
      setFileError('El archivo está vacío.');
      return;
    }
    if (f.size > maxBytes) {
      setFileError(`La imagen pesa ${formatBytes(f.size)}; el máximo es ${formatBytes(maxBytes)}. Toma una captura de pantalla del comprobante.`);
      return;
    }
    const kind = await sniffImage(f);
    if (!kind || !settings.limits.allowed_proof_mime_types.includes(kind.mime)) {
      setFileError('Solo se aceptan imágenes JPG, PNG o WEBP. Si tu foto es HEIC, toma una captura de pantalla.');
      return;
    }
    // Give the file a name whose extension matches its real content (the server rejects mismatches).
    const base = (f.name.replace(/\.[^.]*$/, '') || 'comprobante').slice(0, 80);
    const named = new File([f], `${base}.${kind.ext}`, { type: kind.mime });
    setFile(named);
    setPreview(URL.createObjectURL(named));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setSubmitError(null);
    let amount: string | null;
    if (partialAllowed) {
      amount = parseUserAmount(amountText);
      if (!amount) {
        setAmountError('Escribe el valor que transferiste (solo números).');
        return;
      }
      if (toCents(amount) > remainingCents) {
        setAmountError(
          pendingCents > 0n
            ? `No puede ser mayor que lo que falta por transferir (${formatCOP(remainingCents)}).`
            : `No puede ser mayor que el saldo pendiente (${formatCOP(remainingCents)}).`,
        );
        return;
      }
    } else {
      amount = order.balance_due;
    }
    setAmountError(null);
    if (!file) {
      setFileError('Selecciona la imagen del comprobante.');
      fileInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      await api.uploadProof(token, file, amount);
      setSent(true);
      setFile(null);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
      onUploaded();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <form className="form proof-form" onSubmit={(e) => void onSubmit(e)} noValidate>
      <h3 className="subsection-title">Enviar comprobante</h3>

      <div className="field">
        <label htmlFor={`${uid}-amount`}>Valor transferido</label>
        {partialAllowed ? (
          <>
            <div className="input-prefix">
              <span aria-hidden="true">$</span>
              <input
                id={`${uid}-amount`}
                inputMode="decimal"
                autoComplete="off"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={!!amountError}
                aria-describedby={`${uid}-amount-hint${amountError ? ` ${uid}-amount-err` : ''}`}
              />
            </div>
            <p id={`${uid}-amount-hint`} className="hint">
              {pendingCents > 0n
                ? `Falta por transferir: ${formatCOP(remainingCents)} (saldo ${formatCOP(order.balance_due)} menos ${formatCOP(pendingCents)} en verificación). Puedes pagar una parte.`
                : `Saldo pendiente: ${formatCOP(order.balance_due)}. Puedes pagar una parte.`}
            </p>
          </>
        ) : (
          <>
            <p id={`${uid}-amount`} className="big-amount">
              {formatCOP(order.balance_due)}
            </p>
            <p className="hint">Debe ser el saldo completo (no se aceptan pagos parciales).</p>
          </>
        )}
        {amountError && (
          <p id={`${uid}-amount-err`} className="field-error">
            {amountError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`${uid}-file`}>Imagen del comprobante</label>
        <input
          ref={fileInput}
          id={`${uid}-file`}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => void onFile(e)}
          aria-invalid={!!fileError}
          aria-describedby={`${uid}-file-hint${fileError ? ` ${uid}-file-err` : ''}`}
          disabled={sending}
        />
        <p id={`${uid}-file-hint`} className="hint">
          JPG, PNG o WEBP, máximo {formatBytes(maxBytes)}. Una captura de pantalla funciona bien.
        </p>
        {fileError && (
          <p id={`${uid}-file-err`} className="field-error" role="alert">
            {fileError}
          </p>
        )}
        {preview && file && (
          <figure className="proof-preview">
            <img src={preview} alt="Vista previa del comprobante seleccionado" />
            <figcaption className="muted small">
              {file.name} · {formatBytes(file.size)}
            </figcaption>
          </figure>
        )}
      </div>

      {submitError && <Alert title="No se pudo enviar el comprobante">{submitError}</Alert>}
      {sent && (
        <Alert tone="success" title="¡Comprobante enviado!">
          Quedó <strong>pendiente de verificación</strong>. Cuando confirmemos la transferencia, el estado del pago se
          actualizará en esta página.
        </Alert>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={sending || !file} aria-busy={sending}>
        {sending ? 'Enviando comprobante…' : 'Enviar comprobante'}
      </button>
    </form>
  );
}
