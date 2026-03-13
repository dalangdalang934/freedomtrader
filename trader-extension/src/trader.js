// Freedom Trader (FT) - BSC/SOL 聚合交易终端 | 完全免费，小费自愿
import { isEncrypted } from './crypto.js';
import { state } from './state.js';
import { $ } from './utils.js';
import { LAMPORTS_PER_SOL } from './sol/constants.js';
import { checkAndShowLock, setupLockEvents } from './lock.js';
import { createClient, initWalletClients, initSolWalletKeypairs, renderWalletSelector, loadBalances } from './wallet.js';
import { setupEvents, updateSlippageBtn, renderAllQuickButtons, showToast, applyChainUI } from './ui.js';
import { detectToken } from './token.js';
import { setConnection, stopBlockhashPrefetch } from './sol/connection.js';
import { loadApprovedTokens } from './trading.js';

// ── Storage keys per chain ──────────────────────────────────────────────────
const BSC_CONFIG_KEYS = [
  'wallets', 'activeWalletIds', 'rpcUrl', 'slippage', 'tipRate',
  'gasPrice', 'buyAmount', 'customQuickBuy', 'customSlipValues',
  'customBuyAmounts', 'customSellPcts'
];

const SOL_CONFIG_KEYS = [
  'solWallets', 'solActiveWalletIds', 'solRpcUrl', 'solWssUrl', 'solSlippage',
  'solPriorityFee', 'solJitoTip', 'solBuyAmount', 'solCustomQuickBuy', 'solCustomSlipValues',
  'solCustomBuyAmounts', 'solCustomSellPcts'
];

const ALL_CONFIG_KEYS = [...BSC_CONFIG_KEYS, ...SOL_CONFIG_KEYS, 'currentChain'];

// ── BSC init ────────────────────────────────────────────────────────────────
function initBsc(config) {
  createClient(config.rpcUrl);
  return initWalletClients();
}

// ── SOL init ────────────────────────────────────────────────────────────────
function initSol(config) {
  const rpc = config.solRpcUrl || '';
  const wss = config.solWssUrl || '';
  setConnection(rpc || 'https://solana-rpc.publicnode.com', wss || undefined);
  state.solConfig.rpcUrl = rpc;
  return initSolWalletKeypairs();
}

async function initSolWalletsOnly(config) {
  state.solConfig.rpcUrl = config.solRpcUrl || '';
  stopBlockhashPrefetch();
  return initSolWalletKeypairs();
}

// ── Chain config save/restore ───────────────────────────────────────────────
function solToLamports(solValue) {
  const n = parseFloat(solValue);
  return isNaN(n) ? 0 : Math.round(n * LAMPORTS_PER_SOL);
}

function lamportsToSol(lamports) {
  const n = Number(lamports);
  return isNaN(n) ? '0' : (n / LAMPORTS_PER_SOL).toString();
}

function saveChainConfig() {
  if (state.currentChain === 'bsc') {
    chrome.storage.local.set({
      slippage: $('slippage')?.value,
      gasPrice: $('gasPriceInput')?.value,
      buyAmount: state.amountDrafts.bsc.buy || '',
    });
  } else {
    const priorityFeeLamports = solToLamports($('gasPriceInput')?.value);
    const jitoTipLamports = solToLamports($('jitoTipInput')?.value);
    state.solConfig.priorityFee = priorityFeeLamports;
    state.solConfig.jitoTip = jitoTipLamports;
    chrome.storage.local.set({
      solSlippage: $('slippage')?.value,
      solPriorityFee: priorityFeeLamports,
      solJitoTip: jitoTipLamports,
      solBuyAmount: state.amountDrafts.sol.buy || '',
    });
  }
}

function restoreChainConfig(config) {
  if (state.currentChain === 'bsc') {
    if (config.slippage) { $('slippage').value = config.slippage; updateSlippageBtn(config.slippage); }
    if (config.gasPrice) { $('gasPriceInput').value = config.gasPrice; }
    state.config.buyAmount = config.buyAmount || '';
    if (!state.amountDrafts.bsc.buy) state.amountDrafts.bsc.buy = state.config.buyAmount;
    state.config.customQuickBuy = config.customQuickBuy;
    state.config.customSlipValues = config.customSlipValues;
    state.config.customBuyAmounts = config.customBuyAmounts;
    state.config.customSellPcts = config.customSellPcts;
  } else {
    const slip = config.solSlippage || '15';
    const feeLamports = config.solPriorityFee ?? 100000;
    const jitoLamports = config.solJitoTip ?? 100000;
    const amt = config.solBuyAmount || '';

    $('slippage').value = slip; updateSlippageBtn(slip);
    $('gasPriceInput').value = lamportsToSol(feeLamports);
    const jitoInput = $('jitoTipInput');
    if (jitoInput) jitoInput.value = lamportsToSol(jitoLamports);

    state.solConfig.priorityFee = Number(feeLamports);
    state.solConfig.jitoTip = Number(jitoLamports);
    state.config.solBuyAmount = amt;
    if (!state.amountDrafts.sol.buy) state.amountDrafts.sol.buy = amt;
    state.config.solCustomQuickBuy = config.solCustomQuickBuy;
    state.config.solCustomSlipValues = config.solCustomSlipValues;
    state.config.solCustomBuyAmounts = config.solCustomBuyAmounts;
    state.config.solCustomSellPcts = config.solCustomSellPcts;
  }
}

// ── Chain switching ─────────────────────────────────────────────────────────
async function switchChain(chain) {
  if (chain === state.currentChain) return;
  saveChainConfig();

  state.currentChain = chain;
  chrome.storage.local.set({ currentChain: chain });

  state.tokenInfo = { decimals: chain === 'sol' ? 6 : 18, symbol: '', balance: 0n };
  state.lpInfo = { hasLP: false, isInternal: false, reserveBNB: 0n, reserveToken: 0n };
  state.tokenBalances.clear();
  $('tokenAddress').value = '';
  $('tokenBalanceDisplay').textContent = '-';
  const badge = $('tokenNameBadge'); if (badge) badge.classList.remove('show');
  const lpDiv = $('lpInfo'); if (lpDiv) lpDiv.style.display = 'none';

  const config = await chrome.storage.local.get([...BSC_CONFIG_KEYS, ...SOL_CONFIG_KEYS]);
  restoreChainConfig(config);

  if (chain === 'sol') {
    await initSol(config);
  } else {
    stopBlockhashPrefetch();
  }

  applyChainUI();
  renderAllQuickButtons();
  renderWalletSelector();
  await loadBalances();
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
async function initAfterUnlock() {
  state.config = await chrome.storage.local.get(ALL_CONFIG_KEYS);

  // Legacy single-key migration: write into wallets array first, then normal init handles decryption
  if (state.config.privateKey && !state.config.wallets && isEncrypted(state.config.privateKey)) {
    const legacyWallet = { id: 'legacy', name: '旧钱包', address: '', encryptedKey: state.config.privateKey };
    state.config.wallets = [legacyWallet];
    state.config.activeWalletIds = ['legacy'];
    await chrome.storage.local.set({ wallets: state.config.wallets, activeWalletIds: state.config.activeWalletIds });
  }

  state.wallets = state.config.wallets || [];
  state.activeWalletIds = state.config.activeWalletIds || [];
  state.solWallets = state.config.solWallets || [];
  state.solActiveWalletIds = state.config.solActiveWalletIds || [];
  state.currentChain = state.config.currentChain || 'bsc';

  if (state.wallets.length === 0 && state.solWallets.length === 0) {
    $('noConfig').style.display = 'block';
    $('tradeUI').style.display = 'none';
    return;
  }

  $('noConfig').style.display = 'none';
  $('tradeUI').style.display = 'block';

  // initBsc must complete first: it calls initWallets() which populates both BSC and SOL
  // address maps; initSol then reads the cached result for SOL addresses
  await Promise.all([initBsc(state.config), loadApprovedTokens()]);
  if (state.currentChain === 'sol') await initSol(state.config);
  else await initSolWalletsOnly(state.config);

  restoreChainConfig(state.config);
  applyChainUI();
  renderAllQuickButtons();
  renderWalletSelector();
  await loadBalances();
}

async function init() {
  setupEvents();
  setupLockEvents(initAfterUnlock);

  const chainBsc = $('chainBsc');
  const chainSol = $('chainSol');
  if (chainBsc) chainBsc.addEventListener('click', () => switchChain('bsc'));
  if (chainSol) chainSol.addEventListener('click', () => switchChain('sol'));

  const canProceed = await checkAndShowLock();
  if (!canProceed) return;

  await initAfterUnlock();
}

// ── Entry point ─────────────────────────────────────────────────────────────
function onReady() {
  init();
  setInterval(loadBalances, 30000);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SOL_RPC_UPDATED') {
      state.solConfig.rpcUrl = message.rpcUrl || '';
      if (state.currentChain === 'sol') {
        setConnection(
          message.rpcUrl || 'https://solana-rpc.publicnode.com',
          message.wssUrl || undefined,
        );
      } else {
        stopBlockhashPrefetch();
      }
      showToast('SOL RPC 已切换', 'success');
      if (state.currentChain === 'sol') loadBalances();
      return;
    }

    if (message.type === 'CONTRACT_DETECTED' && message.address) {
      if (message.chain && message.chain !== state.currentChain) {
        switchChain(message.chain);
      }
      const input = $('tokenAddress');
      if (input && (!input.value || input.value !== message.address)) {
        input.value = message.address;
        detectToken(message.address);
        showToast('已自动识别合约地址', 'success');
      }
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
else onReady();
