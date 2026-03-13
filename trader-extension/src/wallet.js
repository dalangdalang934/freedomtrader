import { state } from './state.js';
import { $ } from './utils.js';
import { loadBscBalances, renderBscWalletSelector } from './wallet-bsc.js';
import { loadSolBalances, renderSolWalletSelector } from './wallet-sol.js';

export { createClient, initWalletClients } from './wallet-bsc.js';
export { initSolWalletKeypairs } from './wallet-sol.js';

let _loadBalancesPromise = null;
let _loadBalancesContextKey = '';
let _loadBalancesRequestId = 0;

function getBalanceContextKey() {
  if (state.currentChain === 'sol') {
    return `sol:${state.solConfig.rpcUrl || ''}:${state.solActiveWalletIds.join(',')}`;
  }
  return `bsc:${state.config.rpcUrl || ''}:${state.activeWalletIds.join(',')}`;
}

export function updateBalanceHint() {
  if (state.currentChain === 'sol') {
    $('balanceHint').textContent = `${state.solActiveWalletIds.filter(id => state.solAddresses.has(id)).length} 个钱包`;
  } else {
    $('balanceHint').textContent = `${state.activeWalletIds.filter(id => state.walletClients.has(id)).length} 个钱包`;
  }
}

export function updateSelectedCount() {
  if (state.currentChain === 'sol') {
    $('selectedCount').textContent = state.solActiveWalletIds.filter(id => state.solAddresses.has(id)).length;
  } else {
    $('selectedCount').textContent = state.activeWalletIds.filter(id => state.walletClients.has(id)).length;
  }
}

export async function loadBalances() {
  const contextKey = getBalanceContextKey();
  if (_loadBalancesPromise && _loadBalancesContextKey === contextKey) return _loadBalancesPromise;

  const requestId = ++_loadBalancesRequestId;
  const isCurrent = () => requestId === _loadBalancesRequestId && contextKey === getBalanceContextKey();

  const promise = (async () => {
    const applied = state.currentChain === 'sol'
      ? await loadSolBalances(isCurrent)
      : await loadBscBalances(isCurrent);
    if (applied && isCurrent()) updateBalanceHint();
  })();
  _loadBalancesPromise = promise;
  _loadBalancesContextKey = contextKey;

  try {
    return await promise;
  } finally {
    if (_loadBalancesPromise === promise) {
      _loadBalancesPromise = null;
      _loadBalancesContextKey = '';
    }
  }
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
