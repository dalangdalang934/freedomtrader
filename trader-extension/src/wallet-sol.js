import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { decryptPrivateKey, isEncrypted } from './crypto.js';
import { getConnection } from './sol/connection.js';
import { state } from './state.js';
import { $, escapeHtml } from './utils.js';
export async function initSolWalletKeypairs() {
  state.solKeypairs.clear();
  for (const wallet of state.solWallets) {
    try {
      let key = wallet.encryptedKey;
      if (isEncrypted(key)) { key = await decryptPrivateKey(key); if (!key) continue; }
      const keypair = Keypair.fromSecretKey(bs58.decode(key));
      state.solKeypairs.set(wallet.id, keypair);
    } catch (e) { console.error('初始化 SOL 钱包失败:', wallet.name, e); }
  }
}

export async function loadSolBalances() {
  try {
    const conn = getConnection();
    let totalSOL = 0n;
    const balances = [];
    state.solWalletBalances.clear();

    const activeEntries = state.solActiveWalletIds
      .map(id => ({ id, kp: state.solKeypairs.get(id) }))
      .filter(e => e.kp);

    const bals = await Promise.all(
      activeEntries.map(e => conn.getBalance(e.kp.publicKey).catch(() => 0))
    );

    activeEntries.forEach((e, i) => {
      const lamports = BigInt(bals[i]);
      state.solWalletBalances.set(e.id, lamports);
      totalSOL += lamports;
      balances.push({
        name: state.solWallets.find(w => w.id === e.id)?.name || e.id,
        balance: lamports,
        address: e.kp.publicKey.toBase58(),
      });
    });

    $('bnbBalance').textContent = (Number(totalSOL) / 1e9).toFixed(4);
    $('walletCount').textContent = `${state.solActiveWalletIds.length}/${state.solWallets.length}`;

    if (balances.length > 0) {
      $('balanceDetails').innerHTML = balances.map(b =>
        `<div class="bal-row"><span>${escapeHtml(b.name)}</span><span>${(Number(b.balance) / 1e9).toFixed(4)} SOL</span></div>`
      ).join('');
    }
  } catch (e) { console.error(e); }
}

export function renderSolWalletSelector(container, onRefresh, onLoadBalances) {
  container.innerHTML = state.solWallets.map(w => {
    const isActive = state.solActiveWalletIds.includes(w.id);
    const hasKeypair = state.solKeypairs.has(w.id);
    return `<label class="wallet-chip ${isActive ? 'active' : ''} ${!hasKeypair ? 'error' : ''}" data-id="${w.id}">
      <input type="checkbox" class="wallet-check" data-id="${w.id}" ${isActive ? 'checked' : ''} ${!hasKeypair ? 'disabled' : ''}>
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
