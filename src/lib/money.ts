// Exact money handling: amounts are decimal strings from the server. Any client-side arithmetic is
// done in integer cents (bigint); floating point is never used.
import type { Money } from './types';

const MONEY_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(value: Money): bigint {
  const m = MONEY_RE.exec(value.trim());
  if (!m) throw new Error(`Importe inválido: ${value}`);
  const neg = m[1];
  const int = m[2] ?? '0';
  const frac = m[3] ?? '';
  const cents = BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function fromCents(cents: bigint): Money {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** Formats a money string as Colombian pesos, e.g. "12500.00" -> "$ 12.500". */
export function formatCOP(value: Money | bigint): string {
  const cents = typeof value === 'bigint' ? value : toCents(value);
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = abs % 100n;
  return `${neg ? '-' : ''}$ ${int}${frac === 0n ? '' : ',' + frac.toString().padStart(2, '0')}`;
}

/**
 * Parses an amount typed by a person (es-CO: "12.500", "12500", "12500,50") to a money string.
 * Returns null when it is not a positive amount with at most 2 decimals.
 */
export function parseUserAmount(input: string): Money | null {
  let s = input.replace(/[\s$]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // comma = decimal separator in es-CO; dots are thousands separators
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  if (s.replace('.', '').length > 12) return null;
  const cents = toCents(s);
  if (cents <= 0n) return null;
  return fromCents(cents);
}
