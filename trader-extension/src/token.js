import { state } from './state.js';
import { detectBscToken } from './token-bsc.js';
import { detectSolToken } from './token-sol.js';

export { detectSolToken } from './token-sol.js';
export { detectBscToken } from './token-bsc.js';

export async function detectToken(addr) {
  if (state.currentChain === 'sol') return detectSolToken(addr);
  return detectBscToken(addr);
}
