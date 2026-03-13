import { formatUnits, parseUnits } from 'viem';
import { state } from './state.js';
import { $, formatNum, getTradeAmountDecimals, normalizeAmount, sanitizeAmountInput } from './utils.js';
import { FREEDOM_ROUTER, ROUTER_ABI, HELPER3, HELPER3_ABI, ROUTE } from './constants.js';
import { LAMPORTS_PER_SOL } from './sol/constants.js';

function isSol() { return state.currentChain === 'sol'; }
function nativeSymbol() { return isSol() ? 'SOL' : 'BNB'; }
function getAmountInputDecimals(mode = state.tradeMode) {
  return mode === 'sell'
    ? getTradeAmountDecimals(state.currentChain, 'sell', state.tokenInfo.decimals)
    : null;
}
function getTradeDecimals(mode = state.tradeMode) {
  return getTradeAmountDecimals(state.currentChain, mode, state.tokenInfo.decimals);
}
function getAmountDraftBucket() {
  return state.amountDrafts[state.currentChain];
}
function getStoredBuyAmount() {
  return isSol() ? (state.config.solBuyAmount || '') : (state.config.buyAmount || '');
}
function setStoredBuyAmount(value) {
  const key = isSol() ? 'solBuyAmount' : 'buyAmount';
  if (isSol()) state.config.solBuyAmount = value;
  else state.config.buyAmount = value;
  chrome.storage.local.set({ [key]: value });
}
function getAmountDraft(mode = state.tradeMode) {
  const drafts = getAmountDraftBucket();
  if (mode === 'buy' && drafts.buy === '') {
    drafts.buy = sanitizeAmountInput(getStoredBuyAmount(), null);
  }
  return drafts[mode] || '';
}
function cacheAmountDraft(value, mode = state.tradeMode, persist = mode === 'buy') {
  const sanitized = sanitizeAmountInput(value, getAmountInputDecimals(mode));
  getAmountDraftBucket()[mode] = sanitized;
  if (persist && mode === 'buy') setStoredBuyAmount(sanitized);
  return sanitized;
}
function applyAmountValue(value, mode = state.tradeMode, persist = mode === 'buy') {
  const sanitized = cacheAmountDraft(value, mode, persist);
  const amountEl = $('amount');
  if (amountEl) amountEl.value = sanitized;
  return sanitized;
}
function restoreAmountDraft(mode = state.tradeMode) {
  return applyAmountValue(getAmountDraft(mode), mode, false);
}

export function showStatus(msg, type) {
  $('statusBar').textContent = msg;
  $('statusBar').className = 'status-bar ' + type;
  $('statusBar').style.display = 'block';
}

export function showToast(msg, type = 'success', duration = 3000) {
  const toast = $('toast'); if (!toast) return;
  toast.textContent = msg; toast.className = 'toast ' + type; toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

export function updateSlippageBtn(val) {
  document.querySelectorAll('.slip-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.slip === val));
  $('warningBox').classList.toggle('show', parseFloat(val) >= 25);
}

let _priceTimer = null;
let _priceRequestId = 0;
export function updatePrice() {
  clearTimeout(_priceTimer);
  const requestId = ++_priceRequestId;
  _priceTimer = setTimeout(() => _updatePriceImpl(requestId), 150);
}

function isPriceRequestCurrent(requestId) {
  return requestId === _priceRequestId;
}

async function _updatePriceImpl(requestId) {
  const div = $('priceInfo');
  const amountEl = $('amount');
  const normalizedAmount = normalizeAmount(amountEl?.value || '', getTradeDecimals());
  const amount = parseFloat(normalizedAmount) || 0;
  if (!div || !state.lpInfo.hasLP || amount <= 0) { if (div && isPriceRequestCurrent(requestId)) div.style.display = 'none'; return; }

  const slip = parseFloat($('slippage').value) || 15;
  const sol = isSol();
  const walletCount = sol
    ? state.solActiveWalletIds.filter(id => state.solAddresses.has(id)).length
    : state.activeWalletIds.filter(id => state.walletClients.has(id)).length;
  if (walletCount === 0) { if (div && isPriceRequestCurrent(requestId)) div.style.display = 'none'; return; }
  const amountPerWallet = normalizeAmount((amount / walletCount).toString(), getTradeDecimals());

  const nativeDec = sol ? 9 : 18;
  const ns = nativeSymbol();

  try {
    const route = state.lpInfo.routeSource || ROUTE.NONE;
    const isBscRouter = !sol && state.tokenInfo.address && state.publicClient;
    const isFourInternal = route === ROUTE.FOUR_INTERNAL_BNB || route === ROUTE.FOUR_INTERNAL_ERC20;
    // Buy: FLAP_BONDING uses router quote; FLAP_BONDING_SELL buy goes PancakeSwap (local calc)
    // Sell: FLAP_BONDING + FLAP_BONDING_SELL both use router quote
    const useRouterQuoteBuy = isBscRouter && (isFourInternal || route === ROUTE.FLAP_BONDING);
    const useRouterQuoteSell = isBscRouter && (isFourInternal || route === ROUTE.FLAP_BONDING || route === ROUTE.FLAP_BONDING_SELL);
    const useRouter = state.tradeMode === 'buy' ? useRouterQuoteBuy : useRouterQuoteSell;
    if (useRouter) {
      await _updateRouterPrice(div, amountPerWallet, walletCount, slip, requestId);
      return;
    }

    const quoteReserve = state.lpInfo.reserveBNB;
    const tokenReserve = state.lpInfo.reserveToken;
    if (!isPriceRequestCurrent(requestId)) return;

    if (state.tradeMode === 'buy') {
      const amt = parseUnits(amountPerWallet, nativeDec);
      let est = quoteReserve > 0n ? (amt * tokenReserve) / (quoteReserve + amt) : 0n;
      if (est > tokenReserve) est = tokenReserve;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est, state.tokenInfo.decimals)} ${state.tokenInfo.symbol} × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min * BigInt(walletCount), state.tokenInfo.decimals)} ${state.tokenInfo.symbol}`;
    } else {
      const amt = parseUnits(amountPerWallet, state.tokenInfo.decimals);
      let est = tokenReserve > 0n ? (amt * quoteReserve) / (tokenReserve + amt) : 0n;
      if (est > quoteReserve) est = quoteReserve;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est, nativeDec)} ${ns} × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min * BigInt(walletCount), nativeDec)} ${ns}`;
    }
    div.style.display = 'block';
  } catch (e) {
    if (isPriceRequestCurrent(requestId) && div) div.style.display = 'none';
  }
}

async function _updateRouterPrice(div, amountPerWallet, walletCount, slip, requestId) {
  const token = state.tokenInfo.address;
  const dec = state.tokenInfo.decimals;
  try {
    if (state.tradeMode === 'buy') {
      const funds = parseUnits(amountPerWallet, 18);
      const est = await state.publicClient.readContract({
        address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'quoteBuy', args: [token, funds]
      });
      if (!isPriceRequestCurrent(requestId)) return;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est, dec)} ${state.tokenInfo.symbol} × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min * BigInt(walletCount), dec)} ${state.tokenInfo.symbol}`;
    } else {
      const amt = parseUnits(amountPerWallet, dec);
      const est = await state.publicClient.readContract({
        address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'quoteSell', args: [token, amt]
      });
      if (!isPriceRequestCurrent(requestId)) return;
      const min = (est * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      $('estimatedPrice').textContent = `≈ ${formatNum(est > 0n ? est : 0n, 18)} BNB × ${walletCount}`;
      $('minOutput').textContent = `≥ ${formatNum(min > 0n ? min * BigInt(walletCount) : 0n, 18)} BNB`;
    }
    div.style.display = 'block';
  } catch (e) {
    console.warn('[PRICE] quoteBuy/quoteSell failed:', e.message);
    if (isPriceRequestCurrent(requestId)) div.style.display = 'none';
  }
}

export function switchMode(mode) {
  const prevMode = state.tradeMode;
  const amountEl = $('amount');
  if (amountEl && prevMode !== mode) cacheAmountDraft(amountEl.value, prevMode);
  state.tradeMode = mode;
  const ns = nativeSymbol();
  $('tabBuy').classList.toggle('active', mode === 'buy');
  $('tabSell').classList.toggle('active', mode === 'sell');
  $('tradeBtn').className = 'btn-trade ' + (mode === 'buy' ? 'btn-buy' : 'btn-sell');
  $('tradeBtn').textContent = mode === 'buy' ? '🚀 买入' : '💥 卖出';
  $('amountLabel').textContent = mode === 'buy' ? `买入数量 (${ns}/钱包)` : '卖出数量 (' + state.tokenInfo.symbol + '/钱包)';
  $('buyQuickRow').style.display = mode === 'buy' ? 'flex' : 'none';
  $('sellPercentRow').classList.toggle('show', mode === 'sell');
  restoreAmountDraft(mode);
  updatePrice();
}

export function setMax() {
  const amountEl = $('amount');
  if (!amountEl) return;
  if (state.tradeMode === 'buy') {
    const sol = isSol();
    const activeIds = sol ? state.solActiveWalletIds : state.activeWalletIds;
    const balMap = sol ? state.solWalletBalances : state.walletBalances;
    const nativeDec = sol ? 9 : 18;
    const reserveStr = sol ? '0.01' : '0.005';
    let minBal = null;
    for (const id of activeIds) { const bal = balMap.get(id); if (bal !== undefined && (minBal === null || bal < minBal)) minBal = bal; }
    if (minBal !== null && minBal > 0n) {
      const reserve = parseUnits(reserveStr, nativeDec);
      applyAmountValue(normalizeAmount(formatUnits(minBal > reserve ? minBal - reserve : 0n, nativeDec), nativeDec), 'buy');
    }
    else applyAmountValue('0', 'buy');
  } else { setPercentAmount(100); }
  updatePrice();
}

export function setPercentAmount(pct) {
  const amountEl = $('amount');
  if (!amountEl || !state.tokenInfo.address) {
    if (amountEl) applyAmountValue('0', 'sell', false);
    updatePrice();
    return;
  }
  const activeIds = isSol() ? state.solActiveWalletIds : state.activeWalletIds;
  let minBal = null;
  for (const id of activeIds) { const bal = state.tokenBalances.get(id); if (bal !== undefined && (minBal === null || bal < minBal)) minBal = bal; }
  const sellDec = getTradeAmountDecimals(state.currentChain, 'sell', state.tokenInfo.decimals);
  if (minBal !== null && minBal > 0n) applyAmountValue(normalizeAmount(formatUnits((minBal * BigInt(pct)) / 100n, state.tokenInfo.decimals), sellDec), 'sell', false);
  else applyAmountValue('0', 'sell', false);
  updatePrice();
}

export function renderAllQuickButtons() {
  const sol = isSol();
  const quickBuy = ((sol ? state.config.solCustomQuickBuy : state.config.customQuickBuy) || (sol ? '0.1,0.25,0.5,1,2' : '0.01,0.05,0.1,0.5,1')).split(',').map(s => s.trim()).filter(Boolean);
  const slipVals = ((sol ? state.config.solCustomSlipValues : state.config.customSlipValues) || '5,10,15,25,49').split(',').map(s => s.trim()).filter(Boolean);
  const fastBuyAmts = ((sol ? state.config.solCustomBuyAmounts : state.config.customBuyAmounts) || (sol ? '0.1,0.25,0.5,1' : '0.01,0.05,0.1,0.5')).split(',').map(s => s.trim()).filter(Boolean);
  const fastSellPcts = ((sol ? state.config.solCustomSellPcts : state.config.customSellPcts) || '25,50,75,100').split(',').map(s => s.trim()).filter(Boolean);

  const buyQuickRow = $('buyQuickRow');
  if (buyQuickRow) {
    buyQuickRow.innerHTML = quickBuy.map(a =>
      `<button type="button" class="quick-btn" data-amt="${a}">${a}</button>`
    ).join('');
  }

  const slipRow = $('slipPresets');
  if (slipRow) {
    slipRow.innerHTML = slipVals.map(v =>
      `<button type="button" class="slip-btn slippage-btn" data-slip="${v}">${v}</button>`
    ).join('');
    updateSlippageBtn($('slippage')?.value || '15');
  }

  const fastBuyRow = $('fastBuyRow');
  if (fastBuyRow) {
    fastBuyRow.innerHTML = fastBuyAmts.map(a =>
      `<button type="button" class="fast-btn fast-buy" data-amt="${a}">买${a}${isSol() ? '' : ''}</button>`
    ).join('');
  }

  const fastSellRow = $('fastSellRow');
  if (fastSellRow) {
    fastSellRow.innerHTML = fastSellPcts.map(p =>
      `<button type="button" class="fast-btn fast-sell" data-pct="${p}">${p === '100' ? '全卖' : '卖' + p + '%'}</button>`
    ).join('');
  }
}

export function toggleQuickEdit(show) {
  const panel = $('quickEditPanel');
  if (!panel) return;
  panel.style.display = show ? 'block' : 'none';
  if (show) {
    const sol = isSol();
    const defaults = sol
      ? { qb: '0.1, 0.25, 0.5, 1, 2', ba: '0.1, 0.25, 0.5, 1' }
      : { qb: '0.01, 0.05, 0.1, 0.5, 1', ba: '0.01, 0.05, 0.1, 0.5' };
    $('customQuickBuy').value = (sol ? state.config.solCustomQuickBuy : state.config.customQuickBuy) || defaults.qb;
    $('customSlipValues').value = (sol ? state.config.solCustomSlipValues : state.config.customSlipValues) || '5, 10, 15, 25, 49';
    $('customBuyAmounts').value = (sol ? state.config.solCustomBuyAmounts : state.config.customBuyAmounts) || defaults.ba;
    $('customSellPcts').value = (sol ? state.config.solCustomSellPcts : state.config.customSellPcts) || '25, 50, 75, 100';
  }
}

export function saveQuickConfig() {
  const quickBuy = $('customQuickBuy').value.trim();
  const slipVals = $('customSlipValues').value.trim();
  const fastBuyVal = $('customBuyAmounts').value.trim();
  const fastSellVal = $('customSellPcts').value.trim();
  const sol = isSol();
  if (sol) {
    if (quickBuy) state.config.solCustomQuickBuy = quickBuy;
    if (slipVals) state.config.solCustomSlipValues = slipVals;
    if (fastBuyVal) state.config.solCustomBuyAmounts = fastBuyVal;
    if (fastSellVal) state.config.solCustomSellPcts = fastSellVal;
    chrome.storage.local.set({ solCustomQuickBuy: quickBuy, solCustomSlipValues: slipVals, solCustomBuyAmounts: fastBuyVal, solCustomSellPcts: fastSellVal });
  } else {
    if (quickBuy) state.config.customQuickBuy = quickBuy;
    if (slipVals) state.config.customSlipValues = slipVals;
    if (fastBuyVal) state.config.customBuyAmounts = fastBuyVal;
    if (fastSellVal) state.config.customSellPcts = fastSellVal;
    chrome.storage.local.set({ customQuickBuy: quickBuy, customSlipValues: slipVals, customBuyAmounts: fastBuyVal, customSellPcts: fastSellVal });
  }
  renderAllQuickButtons();
  toggleQuickEdit(false);
  showToast('快捷按钮已更新', 'success');
}

export function applyChainUI() {
  const sol = isSol();
  const ns = nativeSymbol();

  // Chain buttons
  const bscBtn = $('chainBsc');
  const solBtn = $('chainSol');
  if (bscBtn) bscBtn.classList.toggle('active', !sol);
  if (solBtn) solBtn.classList.toggle('active', sol);

  // Balance label
  const balLabel = document.querySelector('.bal-label');
  if (balLabel) balLabel.textContent = `${ns} 余额`;

  // Gas/Priority Fee label + Jito column visibility
  const gasLabel = $('gasLabel');
  const jitoCol = $('jitoCol');
  if (sol) {
    if (gasLabel) gasLabel.textContent = 'Priority Fee (SOL)';
    if (jitoCol) jitoCol.style.display = '';
  } else {
    if (gasLabel) gasLabel.textContent = 'Gas (Gwei)';
    if (jitoCol) jitoCol.style.display = 'none';
  }

  // Address placeholder
  const tokenInput = $('tokenAddress');
  if (tokenInput) tokenInput.placeholder = sol ? 'base58 地址' : '0x...';

  // Amount label
  switchMode(state.tradeMode);
}

// setupEvents 依赖 batch/token，用延迟 import 避免循环依赖
export function setupEvents() {
  const tokenInput = $('tokenAddress');
  const amountInput = $('amount');
  const slippageInput = $('slippage');

  document.addEventListener('click', async (e) => {
    const clickedId = e.target.id;
    if (clickedId === 'editQuickBtn') { e.preventDefault(); toggleQuickEdit(true); return; }

    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.id === 'maxBtn') { e.preventDefault(); setMax(); return; }
    if (t.id === 'tradeBtn') {
      e.preventDefault();
      const { executeBatchTrade } = await import('./batch.js');
      executeBatchTrade();
      return;
    }
    if (t.id === 'tabBuy') { e.preventDefault(); switchMode('buy'); return; }
    if (t.id === 'tabSell') { e.preventDefault(); switchMode('sell'); return; }
    if (t.classList?.contains('slippage-btn') && t.dataset.slip) {
      e.preventDefault(); if (slippageInput) slippageInput.value = t.dataset.slip;
      updateSlippageBtn(t.dataset.slip);
      chrome.storage.local.set({ [isSol() ? 'solSlippage' : 'slippage']: t.dataset.slip });
      updatePrice();
      return;
    }
    if (t.classList?.contains('quick-btn') && t.dataset.amt) {
      e.preventDefault();
      applyAmountValue(t.dataset.amt);
      updatePrice();
      return;
    }
    if (t.classList?.contains('percent-btn') && t.dataset.pct) { e.preventDefault(); setPercentAmount(parseInt(t.dataset.pct, 10)); return; }
    if (t.id === 'settingsBtn' || t.id === 'goSettingsBtn') { e.preventDefault(); location.href = 'settings.html'; return; }
    if (t.classList?.contains('fast-buy') && t.dataset.amt) {
      e.preventDefault();
      const { fastBuy } = await import('./batch.js');
      fastBuy(t.dataset.amt);
      return;
    }
    if (t.classList?.contains('fast-sell') && t.dataset.pct) {
      e.preventDefault();
      const { fastSell } = await import('./batch.js');
      fastSell(parseInt(t.dataset.pct, 10));
      return;
    }
    if (t.id === 'saveQuickBtn') { e.preventDefault(); saveQuickConfig(); return; }
    if (t.id === 'cancelQuickBtn') { e.preventDefault(); toggleQuickEdit(false); return; }
  });

  if (tokenInput) {
    let timer;
    tokenInput.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const { detectToken } = await import('./token.js');
        detectToken(tokenInput.value.trim());
      }, 300);
    };
  }
  if (amountInput) amountInput.oninput = () => {
    applyAmountValue(amountInput.value, state.tradeMode, state.tradeMode === 'buy');
    updatePrice();
  };
  if (slippageInput) slippageInput.oninput = () => {
    updateSlippageBtn(slippageInput.value); updatePrice();
    const key = isSol() ? 'solSlippage' : 'slippage';
    chrome.storage.local.set({ [key]: slippageInput.value });
  };

  const gasInput = $('gasPriceInput');
  if (gasInput) gasInput.oninput = () => {
    if (isSol()) {
      const lamports = Math.round(parseFloat(gasInput.value || '0') * LAMPORTS_PER_SOL);
      state.solConfig.priorityFee = lamports;
      chrome.storage.local.set({ solPriorityFee: lamports });
    } else {
      chrome.storage.local.set({ gasPrice: gasInput.value });
    }
  };

  const jitoInput = $('jitoTipInput');
  if (jitoInput) jitoInput.oninput = () => {
    const lamports = Math.round(parseFloat(jitoInput.value || '0') * LAMPORTS_PER_SOL);
    state.solConfig.jitoTip = lamports;
    chrome.storage.local.set({ solJitoTip: lamports });
  };
}
