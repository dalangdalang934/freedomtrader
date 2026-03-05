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
