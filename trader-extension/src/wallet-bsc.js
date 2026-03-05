import { createPublicClient, createWalletClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { decryptPrivateKey, isEncrypted } from './crypto.js';
import { DEFAULT_RPC } from './constants.js';
import { state } from './state.js';
import { $, escapeHtml } from './utils.js';

export function createClient(rpcUrl) {
  const url = (rpcUrl || '').trim() || DEFAULT_RPC;
  state.publicClient = createPublicClient({ chain: bsc, transport: http(url) });
}

export async function initWalletClients() {
  state.walletClients.clear();
  const rpcUrl = (state.config.rpcUrl || '').trim() || DEFAULT_RPC;
  for (const wallet of state.wallets) {
    try {
      let key = wallet.encryptedKey;
      if (isEncrypted(key)) { key = await decryptPrivateKey(key); if (!key) continue; }
      key = key.startsWith('0x') ? key : '0x' + key;
      const account = privateKeyToAccount(key);
      const client = createWalletClient({ chain: bsc, transport: http(rpcUrl), account });
      state.walletClients.set(wallet.id, { client, account });
    } catch (e) { console.error('初始化钱包失败:', wallet.name, e); }
  }
}

export async function loadBscBalances() {
  try {
    let totalBNB = 0n;
    const balances = [];
    state.walletBalances.clear();
    const activeEntries = state.activeWalletIds.map(id => ({ id, wc: state.walletClients.get(id) })).filter(e => e.wc);
    const bals = await Promise.all(activeEntries.map(e => state.publicClient.getBalance({ address: e.wc.account.address }).catch(() => 0n)));
    activeEntries.forEach((e, i) => {
      state.walletBalances.set(e.id, bals[i]);
      totalBNB += bals[i];
      balances.push({ name: state.wallets.find(w => w.id === e.id)?.name || e.id, balance: bals[i], address: e.wc.account.address });
    });
    $('bnbBalance').textContent = parseFloat(formatUnits(totalBNB, 18)).toFixed(4);
    $('walletCount').textContent = `${state.activeWalletIds.length}/${state.wallets.length}`;
    if (balances.length > 0) {
      $('balanceDetails').innerHTML = balances.map(b =>
        `<div class="bal-row"><span>${escapeHtml(b.name)}</span><span>${parseFloat(formatUnits(b.balance, 18)).toFixed(4)} BNB</span></div>`
      ).join('');
    }
  } catch (e) { console.error(e); }
}

export function renderBscWalletSelector(container, onRefresh, onLoadBalances) {
  container.innerHTML = state.wallets.map(w => {
    const isActive = state.activeWalletIds.includes(w.id);
    const hasClient = state.walletClients.has(w.id);
    return `<label class="wallet-chip ${isActive ? 'active' : ''} ${!hasClient ? 'error' : ''}" data-id="${w.id}">
      <input type="checkbox" class="wallet-check" data-id="${w.id}" ${isActive ? 'checked' : ''} ${!hasClient ? 'disabled' : ''}>
      <span>${escapeHtml(w.name)}</span></label>`;
  }).join('');

  container.querySelectorAll('.wallet-check').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) { if (!state.activeWalletIds.includes(id)) state.activeWalletIds.push(id); }
      else { state.activeWalletIds = state.activeWalletIds.filter(aid => aid !== id); }
      chrome.storage.local.set({ activeWalletIds: state.activeWalletIds });
      onRefresh();
      onLoadBalances();
    };
  });
}
