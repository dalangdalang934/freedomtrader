// Freedom Trader (FT) - BSC 聚合交易终端 | 完全免费，小费自愿
// 通过 FreedomRouter 统一路由：自动判断 Four 内盘 / PancakeSwap 外盘
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, encodeFunctionData, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { decryptPrivateKey, isEncrypted, hasPassword, isUnlocked, unlock } from './crypto.js';

const DEFAULT_TIP_RATE = 0;

// FreedomRouter (ERC1967 Proxy)
const FREEDOM_ROUTER = '0x87083948E696c19B1CE756dd6995D4a615a7f2c3';
const TOKEN_MANAGER_V2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// ABI
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const ROUTER_ABI = [
  {
    name: 'buy', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'tipRate', type: 'uint256' }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'sell', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'tipRate', type: 'uint256' }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'getTokenInfo', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }, { name: 'user', type: 'address' }],
    outputs: [{
      name: 'info', type: 'tuple',
      components: [
        { name: 'symbol', type: 'string' },
        { name: 'decimals', type: 'uint8' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'userBalance', type: 'uint256' },
        { name: 'mode', type: 'uint256' },
        { name: 'isInternal', type: 'bool' },
        { name: 'tradingHalt', type: 'bool' },
        { name: 'tmStatus', type: 'uint256' },
        { name: 'tmFunds', type: 'uint256' },
        { name: 'tmOffers', type: 'uint256' },
        { name: 'tmLastPrice', type: 'uint256' },
        { name: 'tmMaxRaising', type: 'uint256' },
        { name: 'tmLaunchTime', type: 'uint256' },
        { name: 'pair', type: 'address' },
        { name: 'pairReserve0', type: 'uint256' },
        { name: 'pairReserve1', type: 'uint256' },
        { name: 'hasLiquidity', type: 'bool' }
      ]
    }]
  },
  {
    name: 'isInternalToken', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }]
  }
];

// 状态
let config = {};
let publicClient;
let tradeMode = 'buy';
let tokenInfo = { decimals: 18, symbol: '', balance: 0n };
let lpInfo = { hasLP: false, isInternal: false, reserveBNB: 0n, reserveToken: 0n };

let wallets = [];
let activeWalletIds = [];
let walletClients = new Map();
let walletBalances = new Map();
let tokenBalances = new Map();

const $ = id => document.getElementById(id);

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// 解锁遮罩层逻辑
async function checkAndShowLock() {
  const overlay = $('lockOverlay');
  if (!overlay) return true;

  const hasPw = await hasPassword();
  if (!hasPw) {
    overlay.style.display = 'flex';
    $('lockTitle').textContent = '请先设置密码';
    $('lockDesc').textContent = '前往设置页面创建加密密码';
    $('lockInputArea').style.display = 'none';
    $('lockGoSettings').style.display = 'inline-block';
    return false;
  }

  const isUnl = await isUnlocked();
  if (isUnl) {
    overlay.style.display = 'none';
    return true;
  }

  overlay.style.display = 'flex';
  $('lockTitle').textContent = '请输入密码解锁';
  $('lockDesc').textContent = '密码用于解密钱包私钥';
  $('lockInputArea').style.display = 'block';
  $('lockGoSettings').style.display = 'inline-block';

  return false;
}

function setupLockEvents() {
  const unlockBtn = $('lockUnlockBtn');
  const pwInput = $('lockPwInput');
  const goSettings = $('lockGoSettings');

  if (unlockBtn) {
    unlockBtn.onclick = async () => {
      const pw = pwInput.value;
      if (!pw) return;
      const ok = await unlock(pw);
      if (ok) {
        $('lockOverlay').style.display = 'none';
        $('lockError').style.display = 'none';
        pwInput.value = '';
        await initAfterUnlock();
      } else {
        $('lockError').textContent = '密码错误';
        $('lockError').style.display = 'block';
      }
    };
  }
  if (pwInput) {
    pwInput.onkeydown = (e) => { if (e.key === 'Enter') unlockBtn?.click(); };
  }
  if (goSettings) {
    goSettings.onclick = () => { location.href = 'settings.html'; };
  }
}

// 初始化
async function init() {
  setupEvents();
  setupLockEvents();

  const canProceed = await checkAndShowLock();
  if (!canProceed) return;

  await initAfterUnlock();
}

async function initAfterUnlock() {
  config = await chrome.storage.local.get(['wallets', 'activeWalletIds', 'rpcUrl', 'slippage', 'tipRate']);

  if (config.privateKey && !config.wallets) {
    const key = config.privateKey;
    if (isEncrypted(key)) {
      const decrypted = await decryptPrivateKey(key);
      if (decrypted) {
        const account = privateKeyToAccount(decrypted);
        config.wallets = [{ id: 'legacy', name: '旧钱包', address: account.address, encryptedKey: key }];
        config.activeWalletIds = ['legacy'];
      }
    }
  }

  wallets = config.wallets || [];
  activeWalletIds = config.activeWalletIds || [];

  if (wallets.length === 0) {
    $('noConfig').style.display = 'block';
    $('tradeUI').style.display = 'none';
    return;
  }

  $('noConfig').style.display = 'none';
  $('tradeUI').style.display = 'block';

  const rpcUrl = (config.rpcUrl || '').trim();
  publicClient = createPublicClient({ chain: bsc, transport: http(rpcUrl || 'https://rpc-not-configured.invalid') });

  await initWalletClients();
  if (config.slippage) { $('slippage').value = config.slippage; updateSlippageBtn(config.slippage); }
  renderWalletSelector();
  await loadBalances();
}

async function initWalletClients() {
  walletClients.clear();
  const rpcUrl = (config.rpcUrl || '').trim();
  for (const wallet of wallets) {
    try {
      let key = wallet.encryptedKey;
      if (isEncrypted(key)) { key = await decryptPrivateKey(key); if (!key) continue; }
      key = key.startsWith('0x') ? key : '0x' + key;
      const account = privateKeyToAccount(key);
      const client = createWalletClient({ chain: bsc, transport: http(rpcUrl || 'https://rpc-not-configured.invalid'), account });
      walletClients.set(wallet.id, { client, account });
    } catch (e) { console.error('初始化钱包失败:', wallet.name, e); }
  }
}

function renderWalletSelector() {
  const container = $('walletSelector');
  container.innerHTML = wallets.map(w => {
    const isActive = activeWalletIds.includes(w.id);
    const hasClient = walletClients.has(w.id);
    return `<div class="wallet-chip ${isActive ? 'active' : ''} ${!hasClient ? 'error' : ''}" data-id="${w.id}">
      <input type="checkbox" class="wallet-check" data-id="${w.id}" ${isActive ? 'checked' : ''} ${!hasClient ? 'disabled' : ''}>
      <span class="wallet-chip-name">${w.name}</span></div>`;
  }).join('');

  container.querySelectorAll('.wallet-check').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) { if (!activeWalletIds.includes(id)) activeWalletIds.push(id); }
      else { activeWalletIds = activeWalletIds.filter(aid => aid !== id); }
      chrome.storage.local.set({ activeWalletIds });
      renderWalletSelector();
      loadBalances();
    };
  });
  container.querySelectorAll('.wallet-chip').forEach(chip => {
    chip.onclick = (e) => { if (e.target.classList.contains('wallet-check')) return; const cb = chip.querySelector('.wallet-check'); if (cb && !cb.disabled) cb.click(); };
  });
  updateSelectedCount();
}

function updateSelectedCount() { $('selectedCount').textContent = activeWalletIds.filter(id => walletClients.has(id)).length; }

async function loadBalances() {
  try {
    let totalBNB = 0n;
    const balances = [];
    walletBalances.clear();
    for (const id of activeWalletIds) {
      const wc = walletClients.get(id);
      if (!wc) continue;
      const bal = await publicClient.getBalance({ address: wc.account.address });
      walletBalances.set(id, bal);
      totalBNB += bal;
      balances.push({ name: wallets.find(w => w.id === id)?.name || id, balance: bal, address: wc.account.address });
    }
    $('bnbBalance').textContent = parseFloat(formatUnits(totalBNB, 18)).toFixed(4);
    $('walletCount').textContent = `${activeWalletIds.length}/${wallets.length}`;
    if (balances.length > 0) {
      $('balanceDetails').innerHTML = balances.map(b =>
        `<div class="balance-row-item"><span>${b.name}</span><span>${parseFloat(formatUnits(b.balance, 18)).toFixed(4)} BNB</span></div>`
      ).join('');
    }
    updateBalanceHint();
  } catch (e) { console.error(e); }
}

function updateBalanceHint() { $('balanceHint').textContent = `${activeWalletIds.filter(id => walletClients.has(id)).length} 个钱包`; }

// ==================== 代币检测（通过 FreedomRouter.getTokenInfo） ====================

async function detectToken(addr) {
  if (!addr || !isValidAddress(addr)) {
    tokenInfo = { decimals: 18, symbol: '', balance: 0n };
    lpInfo = { hasLP: false, isInternal: false };
    $('tokenBalanceDisplay').textContent = '-';
    const lpDiv = $('lpInfo'); if (lpDiv) lpDiv.style.display = 'none';
    const priceDiv = $('priceInfo'); if (priceDiv) priceDiv.style.display = 'none';
    return;
  }

  showStatus('检测中...', 'pending');

  try {
    const firstWallet = walletClients.get(activeWalletIds[0]);
    const userAddr = firstWallet?.account.address || '0x0000000000000000000000000000000000000000';

    const info = await publicClient.readContract({
      address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'getTokenInfo',
      args: [addr, userAddr]
    });

    // 汇总所有选中钱包的代币余额
    let totalBalance = 0n;
    tokenBalances.clear();
    for (const id of activeWalletIds) {
      const wc = walletClients.get(id);
      if (!wc) continue;
      const bal = await publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [wc.account.address] }).catch(() => 0n);
      tokenBalances.set(id, bal);
      totalBalance += bal;
    }

    tokenInfo = { decimals: info.decimals, symbol: info.symbol || '???', balance: totalBalance, address: addr };
    $('tokenBalanceDisplay').textContent = parseFloat(formatUnits(totalBalance, info.decimals)).toFixed(4);

    const hasPool = info.isInternal || info.hasLiquidity;
    lpInfo = {
      hasLP: hasPool,
      isInternal: info.isInternal,
      reserveBNB: info.isInternal ? info.tmFunds : info.pairReserve0,
      reserveToken: info.isInternal ? info.tmOffers : info.pairReserve1,
      tmFunds: info.tmFunds,
      tmOffers: info.tmOffers,
      pair: info.pair,
    };

    if (hasPool) {
      showLPInfo(info);
      showStatus(info.isInternal ? 'Four.meme 内盘' : 'PancakeSwap 外盘', 'success');
    } else {
      showStatus('未找到LP', 'error');
    }

    updateBalanceHint();
    updatePrice();
  } catch (e) {
    console.error(e);
    showStatus('检测失败', 'error');
  }
}

function showLPInfo(info) {
  let div = $('lpInfo');
  if (!div) {
    div = document.createElement('div');
    div.id = 'lpInfo';
    div.style.cssText = 'background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;';
    document.querySelector('.trade-card').insertBefore(div, document.querySelector('.tabs'));
  }

  const poolType = info.isInternal ? '🔥 Four.meme 内盘' : '🥞 PancakeSwap';
  const poolColor = info.isInternal ? '#ff6b6b' : '#00d4aa';
  const quoteVal = info.isInternal ? info.tmFunds : info.pairReserve0;
  const tokenVal = info.isInternal ? info.tmOffers : info.pairReserve1;

  div.style.display = 'block';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
      <span style="color:#888;">${poolType}</span>
      <span style="color:${poolColor};">✓ 已找到</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <div><div style="color:#666;font-size:10px;">BNB</div><div style="color:#f0b90b;">${formatNum(quoteVal, 18)}</div></div>
      <div style="text-align:right;"><div style="color:#666;font-size:10px;">${tokenInfo.symbol}</div><div style="color:#00d4aa;">${formatNum(tokenVal, tokenInfo.decimals)}</div></div>
    </div>
  `;
}

// ==================== 交易（统一走 FreedomRouter） ====================

function getTipRate() {
  const raw = (config.tipRate != null && config.tipRate !== '') ? Number(config.tipRate) : DEFAULT_TIP_RATE;
  const pct = Math.max(0, Math.min(5, raw));
  return BigInt(Math.floor(pct * 100));
}

async function refreshTipConfig() {
  const c = await chrome.storage.local.get(['tipRate']);
  if (c.tipRate != null) config.tipRate = c.tipRate;
}

async function buy(walletId, tokenAddr, amountStr, gasPrice) {
  const wc = walletClients.get(walletId);
  if (!wc) throw new Error('钱包未初始化');
  await refreshTipConfig();

  const amt = parseUnits(amountStr, 18);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const tipRate = getTipRate();

  const t0 = performance.now();
  console.log('[BUY] token:', tokenAddr, 'amount:', amountStr, 'BNB, tipRate:', tipRate.toString());

  const txHash = await wc.client.writeContract({
    address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'buy',
    args: [tokenAddr, 0n, deadline, tipRate],
    value: amt, gas: 500000n, gasPrice: parseUnits(gasPrice.toString(), 9)
  });

  const tSent = performance.now();
  console.log(`[BUY] txHash: ${txHash} | 发送耗时: ${((tSent - t0) / 1000).toFixed(2)}s`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120000 });
  const tConfirm = performance.now();

  if (receipt.status !== 'success') throw new Error('交易失败: ' + txHash);
  console.log(`[BUY] ✓ 确认 | 等待: ${((tConfirm - tSent) / 1000).toFixed(2)}s | 总计: ${((tConfirm - t0) / 1000).toFixed(2)}s`);

  // 内盘买入后自动 approve 给 TM_V2（方便后续卖出）
  if (lpInfo.isInternal) {
    try {
      const approveTx = await wc.client.writeContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
        args: [TOKEN_MANAGER_V2, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        gas: 150000n, gasPrice: parseUnits(gasPrice.toString(), 9)
      });
      console.log('[BUY] 自动 approve 给 TM_V2:', approveTx);
    } catch (e) { console.warn('[BUY] 自动 approve 失败:', e.message); }
  } else {
    try {
      const approveTx = await wc.client.writeContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
        args: [FREEDOM_ROUTER, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        gas: 150000n, gasPrice: parseUnits(gasPrice.toString(), 9)
      });
      console.log('[BUY] 自动 approve 给 Router:', approveTx);
    } catch (e) { console.warn('[BUY] 自动 approve 失败:', e.message); }
  }

  return { txHash, sendMs: tSent - t0, confirmMs: tConfirm - tSent, totalMs: tConfirm - t0 };
}

async function sell(walletId, tokenAddr, amountStr, gasPrice) {
  const wc = walletClients.get(walletId);
  if (!wc) throw new Error('钱包未初始化');
  await refreshTipConfig();

  const amt = parseUnits(amountStr, tokenInfo.decimals);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const tipRate = getTipRate();

  // 检查余额
  const balance = await publicClient.readContract({
    address: tokenAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [wc.account.address]
  });
  if (balance < amt) throw new Error('代币余额不足');

  // 内盘: approve 给 TM_V2; 外盘: approve 给 Router Proxy
  const approveTarget = lpInfo.isInternal ? TOKEN_MANAGER_V2 : FREEDOM_ROUTER;
  const allowance = await publicClient.readContract({
    address: tokenAddr, abi: ERC20_ABI, functionName: 'allowance', args: [wc.account.address, approveTarget]
  });

  if (allowance < amt) {
    console.log('[SELL] approve 给', lpInfo.isInternal ? 'TM_V2' : 'Router');
    const approveTx = await wc.client.writeContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
      args: [approveTarget, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
      gas: 150000n, gasPrice: parseUnits(gasPrice.toString(), 9)
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const t0 = performance.now();
  console.log('[SELL] token:', tokenAddr, 'amount:', amountStr, 'tipRate:', tipRate.toString());

  const txHash = await wc.client.writeContract({
    address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'sell',
    args: [tokenAddr, amt, 0n, deadline, tipRate],
    gas: 500000n, gasPrice: parseUnits(gasPrice.toString(), 9)
  });

  const tSent = performance.now();
  console.log(`[SELL] txHash: ${txHash} | 发送耗时: ${((tSent - t0) / 1000).toFixed(2)}s`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120000 });
  const tConfirm = performance.now();

  if (receipt.status !== 'success') throw new Error('交易失败: ' + txHash);
  console.log(`[SELL] ✓ 确认 | 等待: ${((tConfirm - tSent) / 1000).toFixed(2)}s | 总计: ${((tConfirm - t0) / 1000).toFixed(2)}s`);

  return { txHash, sendMs: tSent - t0, confirmMs: tConfirm - tSent, totalMs: tConfirm - t0 };
}

// ==================== 批量交易 ====================

async function executeBatchTrade() {
  const tokenAddr = $('tokenAddress').value.trim();
  const amountStr = $('amount').value;
  const gasPrice = parseFloat($('gasPriceInput').value) || 3;

  if (!tokenAddr || !lpInfo.hasLP) { showStatus('请输入有效的代币地址', 'error'); return; }
  const amount = parseFloat(amountStr);
  if (!amountStr || amount <= 0) { showStatus('请输入数量', 'error'); return; }

  const activeWallets = activeWalletIds.filter(id => walletClients.has(id));
  if (activeWallets.length === 0) { showStatus('请选择至少一个钱包', 'error'); return; }

  const mode = tradeMode === 'buy' ? '买入' : '卖出';
  const batchT0 = performance.now();
  showStatus(`准备${mode} (${activeWallets.length}个钱包)...`, 'pending');

  try {
    const promises = activeWallets.map(id =>
      tradeMode === 'buy' ? buy(id, tokenAddr, amountStr, gasPrice) : sell(id, tokenAddr, amountStr, gasPrice)
    );

    const results = await Promise.allSettled(promises);
    const batchElapsed = ((performance.now() - batchT0) / 1000).toFixed(2);

    let success = 0, failed = 0;
    const timings = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        success++;
        timings.push(r.value);
      } else {
        failed++;
        console.error(`钱包 ${activeWallets[i]} 交易失败:`, r.reason);
      }
    });

    const timeStr = timings.length > 0
      ? ` | ${batchElapsed}s (发送 ${(Math.max(...timings.map(t => t.sendMs)) / 1000).toFixed(1)}s + 确认 ${(Math.max(...timings.map(t => t.confirmMs)) / 1000).toFixed(1)}s)`
      : '';

    if (failed === 0) { showStatus(`✓ 全部成功${timeStr}`, 'success'); showToast(`🎉 交易成功 (${success}个钱包) ${batchElapsed}s`, 'success'); }
    else if (success > 0) { showStatus(`成功 ${success}，失败 ${failed}${timeStr}`, 'error'); showToast(`⚠️ 部分成功 ${success}/${success + failed}`, 'pending'); }
    else { showStatus(`全部失败 (${failed}个)`, 'error'); showToast('❌ 交易失败', 'error'); }

    await loadBalances();
    await detectToken(tokenAddr);
  } catch (e) {
    console.error(e);
    showStatus('批量交易失败: ' + e.message, 'error');
  }
}

// ==================== UI 辅助 ====================

function formatNum(val, dec) {
  const n = parseFloat(formatUnits(val, dec));
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(4);
}

function updatePrice() {
  const div = $('priceInfo');
  const amount = parseFloat($('amount').value) || 0;
  if (!div || !lpInfo.hasLP || amount <= 0) { if (div) div.style.display = 'none'; return; }

  const slip = parseFloat($('slippage').value) || 15;
  const walletCount = activeWalletIds.filter(id => walletClients.has(id)).length;
  const amountPerWallet = amount / walletCount;

  try {
    const quoteReserve = lpInfo.reserveBNB;
    const tokenReserve = lpInfo.reserveToken;

    if (tradeMode === 'buy') {
      const amt = parseUnits(amountPerWallet.toString(), 18);
      const est = quoteReserve > 0n ? (amt * tokenReserve) / quoteReserve : 0n;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est, tokenInfo.decimals)} ${tokenInfo.symbol} × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min * BigInt(walletCount), tokenInfo.decimals)} ${tokenInfo.symbol}`;
    } else {
      const amt = parseUnits(amountPerWallet.toString(), tokenInfo.decimals);
      const est = tokenReserve > 0n ? (amt * quoteReserve) / tokenReserve : 0n;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est, 18)} BNB × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min * BigInt(walletCount), 18)} BNB`;
    }
    div.style.display = 'block';
  } catch (e) { div.style.display = 'none'; }
}

function setupEvents() {
  const el = (id) => document.getElementById(id);
  const tokenInput = el('tokenAddress');
  const amountInput = el('amount');
  const slippageInput = el('slippage');

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.id === 'maxBtn') { e.preventDefault(); setMax(); return; }
    if (t.id === 'tradeBtn') { e.preventDefault(); executeBatchTrade(); return; }
    if (t.id === 'tabBuy') { e.preventDefault(); switchMode('buy'); return; }
    if (t.id === 'tabSell') { e.preventDefault(); switchMode('sell'); return; }
    if (t.classList?.contains('slippage-btn') && t.dataset.slip) {
      e.preventDefault(); if (slippageInput) slippageInput.value = t.dataset.slip;
      updateSlippageBtn(t.dataset.slip); chrome.storage.local.set({ slippage: t.dataset.slip }); updatePrice(); return;
    }
    if (t.classList?.contains('quick-btn') && t.dataset.amt) { e.preventDefault(); if (amountInput) amountInput.value = t.dataset.amt; updatePrice(); return; }
    if (t.classList?.contains('percent-btn') && t.dataset.pct) { e.preventDefault(); setPercentAmount(parseInt(t.dataset.pct, 10)); return; }
    if (t.id === 'pasteBtn') { e.preventDefault(); pasteAddress(); return; }
    if (t.id === 'settingsBtn' || t.id === 'goSettingsBtn') { e.preventDefault(); location.href = 'settings.html'; return; }
  });

  if (tokenInput) { let timer; tokenInput.oninput = () => { clearTimeout(timer); timer = setTimeout(() => detectToken(tokenInput.value.trim()), 300); }; }
  if (amountInput) amountInput.oninput = updatePrice;
  if (slippageInput) slippageInput.oninput = () => { updateSlippageBtn(slippageInput.value); updatePrice(); };
}

async function pasteAddress() {
  try { const txt = await navigator.clipboard.readText(); const input = $('tokenAddress'); if (input) input.value = txt; detectToken(txt.trim()); } catch (err) { console.warn('粘贴失败', err); }
}

function switchMode(mode) {
  tradeMode = mode;
  $('tabBuy').classList.toggle('active', mode === 'buy');
  $('tabSell').classList.toggle('active', mode === 'sell');
  $('tradeBtn').className = 'btn-trade ' + (mode === 'buy' ? 'btn-buy' : 'btn-sell');
  $('tradeBtn').innerHTML = mode === 'buy' ? '🚀 买入' : '💥 卖出';
  $('amountLabel').textContent = mode === 'buy' ? '买入数量 (BNB/钱包)' : '卖出数量 (' + tokenInfo.symbol + '/钱包)';
  $('buyQuickRow').style.display = mode === 'buy' ? 'flex' : 'none';
  $('sellPercentRow').classList.toggle('show', mode === 'sell');
  updatePrice();
}

function setMax() {
  const amountEl = $('amount');
  if (!amountEl) return;
  if (tradeMode === 'buy') {
    let minBal = null;
    for (const id of activeWalletIds) { const bal = walletBalances.get(id); if (bal !== undefined && (minBal === null || bal < minBal)) minBal = bal; }
    if (minBal !== null && minBal > 0n) { const reserve = parseUnits('0.005', 18); amountEl.value = formatUnits(minBal > reserve ? minBal - reserve : 0n, 18); }
    else amountEl.value = '0';
  } else { setPercentAmount(100); }
  updatePrice();
}

function setPercentAmount(pct) {
  const amountEl = $('amount');
  if (!amountEl || !tokenInfo.address) { if (amountEl) amountEl.value = '0'; updatePrice(); return; }
  let minBal = null;
  for (const id of activeWalletIds) { const bal = tokenBalances.get(id); if (bal !== undefined && (minBal === null || bal < minBal)) minBal = bal; }
  if (minBal !== null && minBal > 0n) amountEl.value = formatUnits((minBal * BigInt(pct)) / 100n, tokenInfo.decimals);
  else amountEl.value = '0';
  updatePrice();
}

function updateSlippageBtn(val) {
  document.querySelectorAll('.slippage-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.slip === val));
  $('warningBox').classList.toggle('show', parseFloat(val) >= 25);
}

function showStatus(msg, type) { $('statusBar').textContent = msg; $('statusBar').className = 'status-bar ' + type; $('statusBar').style.display = 'block'; }

function showToast(msg, type = 'success', duration = 3000) {
  const toast = $('toast'); if (!toast) return;
  toast.textContent = msg; toast.className = 'toast ' + type; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// 初始化
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
else onReady();

function onReady() {
  init();
  setInterval(loadBalances, 30000);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONTRACT_DETECTED' && message.address) {
      const input = $('tokenAddress');
      if (input && (!input.value || input.value !== message.address)) {
        input.value = message.address;
        detectToken(message.address);
        showToast('已自动识别合约地址', 'success');
      }
    }
  });
}
