import { formatUnits } from 'viem';

export const $ = id => document.getElementById(id);

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export function isValidSolAddress(addr) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

export function formatNum(val, dec) {
  const n = parseFloat(formatUnits(val, dec));
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(4);
}

export function getTradeAmountDecimals(chain, mode, tokenDecimals) {
  if (mode === 'sell') {
    const fallback = chain === 'sol' ? 6 : 18;
    return Math.min(2, tokenDecimals ?? fallback);
  }
  return chain === 'sol' ? 9 : 18;
}

/**
 * Sanitize live input while preserving typing-friendly intermediate states
 * such as `0.`, `0.10`, and an empty string. When `maxDec` is null, the
 * fractional part is left untouched.
 */
export function sanitizeAmountInput(input, maxDec = null) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  let s = raw.replace(/[^\d.]/g, '');
  if (!s) return '';

  const dotIndex = s.indexOf('.');
  if (dotIndex !== -1) {
    s = s.slice(0, dotIndex + 1) + s.slice(dotIndex + 1).replace(/\./g, '');
  }

  if (s.startsWith('.')) s = `0${s}`;

  const hasDot = s.includes('.');
  let [intPart, fracPart = ''] = s.split('.');
  intPart = (intPart || '0').replace(/^0+(?=\d)/, '') || '0';

  if (!hasDot) return intPart;
  if (typeof maxDec === 'number') fracPart = fracPart.slice(0, maxDec);
  return `${intPart}.${fracPart}`;
}

/**
 * Normalize a decimal string for calculations/submission. This keeps only the
 * fractional digits supported by the trade flow and strips trailing zeros.
 */
export function normalizeAmount(input, maxDec = 18) {
  const s = sanitizeAmountInput(input, maxDec);
  if (!s) return '0';
  if (s.endsWith('.')) return s.slice(0, -1) || '0';

  const [intPart, fracPart = ''] = s.split('.');
  const trimmedFrac = fracPart.replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}
