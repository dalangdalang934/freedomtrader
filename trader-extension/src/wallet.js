import { state } from './state.js';
import { $ } from './utils.js';
import { loadBscBalances, renderBscWalletSelector } from './wallet-bsc.js';
import { loadSolBalances, renderSolWalletSelector } from './wallet-sol.js';

export { createClient, initWalletClients } from './wallet-bsc.js';
export { initSolWalletKeypairs } from './wallet-sol.js';

export function updateBalanceHint() {
  if (state.currentChain === 'sol') {
    $('balanceHint').textContent = `${state.solActiveWalletIds.filter(id => state.solKeypairs.has(id)).length} 个钱包`;
  } else {
    $('balanceHint').textContent = `${state.activeWalletIds.filter(id => state.walletClients.has(id)).length} 个钱包`;
  }
}

export function updateSelectedCount() {
  if (state.currentChain === 'sol') {
    $('selectedCount').textContent = state.solActiveWalletIds.filter(id => state.solKeypairs.has(id)).length;
  } else {
    $('selectedCount').textContent = state.activeWalletIds.filter(id => state.walletClients.has(id)).length;
  }
}

export async function loadBalances() {
  if (state.currentChain === 'sol') await loadSolBalances();
  else await loadBscBalances();
  updateBalanceHint();
}

export function renderWalletSelector() {
  const container = $('walletSelector');
  if (state.currentChain === 'sol') {
    renderSolWalletSelector(container, renderWalletSelector, loadBalances);
  } else {
    renderBscWalletSelector(container, renderWalletSelector, loadBalances);
  }

  // label 包裹 checkbox，点击 label 任意处即可切换，无需额外 onclick
  updateSelectedCount();
}
