import { PublicKey } from '@solana/web3.js';
import { initWallets } from './crypto.js';
import { getConnection } from './sol/connection.js';
import { state } from './state.js';
import { $, escapeHtml } from './utils.js';

export async function initSolWalletKeypairs() {
  state.solAddresses.clear();
  try {
    const cached = state._initWalletsResult;
    const result = cached || await initWallets();
    if (cached) delete state._initWalletsResult;
    for (const [id, addrStr] of Object.entries(result.sol || {})) {
      state.solAddresses.set(id, new PublicKey(addrStr));
    }
  } catch (e) {
    console.error('初始化 SOL 钱包失败:', e);
  }
}

export async function loadSolBalances(isCurrent = () => true) {
  try {
    const conn = getConnection();
    let totalSOL = 0n;
    const balances = [];
    state.solWalletBalances.clear();

    const activeEntries = state.solActiveWalletIds
      .map(id => ({ id, pubkey: state.solAddresses.get(id) }))
      .filter(e => e.pubkey);

    const bals = await Promise.all(
      activeEntries.map(e => conn.getBalance(e.pubkey).catch(() => 0))
    );
    if (!isCurrent()) return false;

    activeEntries.forEach((e, i) => {
      const lamports = BigInt(bals[i]);
      state.solWalletBalances.set(e.id, lamports);
      totalSOL += lamports;
      balances.push({
        name: state.solWallets.find(w => w.id === e.id)?.name || e.id,
        balance: lamports,
        address: e.pubkey.toBase58(),
      });
    });

    $('bnbBalance').textContent = (Number(totalSOL) / 1e9).toFixed(4);
    $('walletCount').textContent = `${state.solActiveWalletIds.length}/${state.solWallets.length}`;

    if (balances.length > 0) {
      $('balanceDetails').innerHTML = balances.map(b =>
        `<div class="bal-row"><span>${escapeHtml(b.name)}</span><span>${(Number(b.balance) / 1e9).toFixed(4)} SOL</span></div>`
      ).join('');
    } else {
      $('balanceDetails').innerHTML = '';
    }
    return true;
  } catch (e) { console.error(e); }
  return false;
}

export function renderSolWalletSelector(container, onRefresh, onLoadBalances) {
  container.innerHTML = state.solWallets.map(w => {
    const isActive = state.solActiveWalletIds.includes(w.id);
    const hasAddress = state.solAddresses.has(w.id);
    return `<label class="wallet-chip ${isActive ? 'active' : ''} ${!hasAddress ? 'error' : ''}" data-id="${w.id}">
      <input type="checkbox" class="wallet-check" data-id="${w.id}" ${isActive ? 'checked' : ''} ${!hasAddress ? 'disabled' : ''}>
      <span>${escapeHtml(w.name)}</span></label>`;
  }).join('');

  container.querySelectorAll('.wallet-check').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) { if (!state.solActiveWalletIds.includes(id)) state.solActiveWalletIds.push(id); }
      else { state.solActiveWalletIds = state.solActiveWalletIds.filter(aid => aid !== id); }
      chrome.storage.local.set({ solActiveWalletIds: state.solActiveWalletIds });
      onRefresh();
      onLoadBalances();
    };
  });
}
