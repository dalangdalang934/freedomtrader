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

/**
 * Truncate decimal string to at most `maxDec` fractional digits and strip
 * trailing zeros. Prevents parseUnits from throwing when formatUnits outputs
 * more decimals than the target precision (e.g. 19 digits into 18-dec field).
 * Default 18 covers BNB; callers may pass a lower value for other tokens.
 */
export function normalizeAmount(input, maxDec = 3) {
  const s = String(input ?? '').trim();
  if (!s) return '0';
  if (/[eE]/.test(s)) return '0';
  if (!/^\d*\.?\d*$/.test(s)) return '0';

  let [intPart, fracPart] = s.split('.');
  intPart = (intPart || '0').replace(/^0+(?=\d)/, '') || '0';

  if (fracPart === undefined) return intPart;
  fracPart = fracPart.slice(0, maxDec).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}
