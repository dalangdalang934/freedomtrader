import { formatUnits, parseUnits } from 'viem';
import { state } from './state.js';
import { $ } from './utils.js';
import { showStatus, showToast } from './ui.js';
import { buy, sell } from './trading.js';
import { solBuy, solSell } from './sol-trading.js';
import { loadBalances } from './wallet.js';
import { detectToken } from './token.js';

function isSol() { return state.currentChain === 'sol'; }
function quoteSymbol() { return isSol() ? 'SOL' : 'BNB'; }

function getActiveWallets() {
  if (isSol()) {
    return state.solActiveWalletIds.filter(id => state.solKeypairs.has(id));
  }
  return state.activeWalletIds.filter(id => state.walletClients.has(id));
}

function getSlippage() {
  return parseFloat($('slippage')?.value) || 15;
}

function getPriorityFee() {
  if (isSol()) {
    const solVal = parseFloat($('gasPriceInput')?.value);
    return Math.floor((solVal > 0 ? solVal : 0.0001) * 1e9);
  }
  return parseFloat($('gasPriceInput')?.value) || 3;
}

function getJitoTip() {
  const solVal = parseFloat($('jitoTipInput')?.value);
  return Math.floor((solVal > 0 ? solVal : 0.0001) * 1e9);
}

function doBuy(id, tokenAddr, amountStr) {
  if (isSol()) {
    return solBuy(id, tokenAddr, parseFloat(amountStr), getSlippage(), {
      priorityFee: getPriorityFee(),
      jitoTip: getJitoTip(),
    });
  }
  return buy(id, tokenAddr, amountStr, getPriorityFee());
}

function doSell(id, tokenAddr, amountStr) {
  if (isSol()) {
    let solSellAmount = amountStr;
    if (!amountStr.endsWith('%')) {
      const dec = state.tokenInfo.decimals || 6;
      solSellAmount = parseUnits(amountStr, dec).toString();
    }
    return solSell(id, tokenAddr, solSellAmount, getSlippage(), {
      priorityFee: getPriorityFee(),
      jitoTip: getJitoTip(),
    });
  }
  return sell(id, tokenAddr, amountStr, getPriorityFee());
}

export async function executeBatchTrade() {
  const tokenAddr = $('tokenAddress').value.trim();
  const amountStr = $('amount').value;

  if (!tokenAddr || !state.lpInfo.hasLP) { showStatus('请输入有效的代币地址', 'error'); return; }
  const amount = parseFloat(amountStr);
  if (!amountStr || amount <= 0) { showStatus('请输入数量', 'error'); return; }

  const activeWallets = getActiveWallets();
  if (activeWallets.length === 0) { showStatus('请选择至少一个钱包', 'error'); return; }

  const mode = state.tradeMode === 'buy' ? '买入' : '卖出';
  const batchT0 = performance.now();
  showStatus(`准备${mode} (${activeWallets.length}个钱包)...`, 'pending');

  try {
    const promises = activeWallets.map(id =>
      state.tradeMode === 'buy' ? doBuy(id, tokenAddr, amountStr) : doSell(id, tokenAddr, amountStr)
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
      ? ` | ${batchElapsed}s (${timings[0].buildMs != null
          ? `构建 ${(Math.max(...timings.map(t => t.buildMs || 0)) / 1000).toFixed(1)}s + 发送 ${(Math.max(...timings.map(t => t.sendMs)) / 1000).toFixed(1)}s + 确认 ${(Math.max(...timings.map(t => t.confirmMs)) / 1000).toFixed(1)}s`
          : `发送 ${(Math.max(...timings.map(t => t.sendMs)) / 1000).toFixed(1)}s + 确认 ${(Math.max(...timings.map(t => t.confirmMs)) / 1000).toFixed(1)}s`})`
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

export async function fastBuy(amountStr) {
  const tokenAddr = $('tokenAddress').value.trim();
  if (!tokenAddr || !state.lpInfo.hasLP) { showStatus('请先输入代币地址', 'error'); return; }
  const activeWallets = getActiveWallets();
  if (activeWallets.length === 0) { showStatus('请选择至少一个钱包', 'error'); return; }

  const unit = quoteSymbol();
  const batchT0 = performance.now();
  showStatus(`⚡ 快速买入 ${amountStr} ${unit} × ${activeWallets.length}...`, 'pending');

  try {
    const results = await Promise.allSettled(activeWallets.map(id => doBuy(id, tokenAddr, amountStr)));
    const elapsed = ((performance.now() - batchT0) / 1000).toFixed(2);
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) { showStatus(`✓ 买入成功 ${elapsed}s`, 'success'); showToast(`⚡ 买入 ${amountStr} ${unit} 成功`, 'success'); }
    else if (ok > 0) { showStatus(`成功 ${ok} / 失败 ${fail}`, 'error'); }
    else { showStatus('买入全部失败', 'error'); showToast('❌ 买入失败', 'error'); }
    await loadBalances();
    await detectToken(tokenAddr);
  } catch (e) { showStatus('快速买入失败: ' + e.message, 'error'); }
}

export async function fastSell(pct) {
  const tokenAddr = $('tokenAddress').value.trim();
  if (!tokenAddr || !state.lpInfo.hasLP) { showStatus('请先输入代币地址', 'error'); return; }
  if (!state.tokenInfo.address) { showStatus('请先检测代币', 'error'); return; }
  const activeWallets = getActiveWallets();
  if (activeWallets.length === 0) { showStatus('请选择至少一个钱包', 'error'); return; }

  const batchT0 = performance.now();
  showStatus(`⚡ 快速卖出 ${pct}% × ${activeWallets.length}...`, 'pending');

  try {
    let sellPromises;
    if (isSol()) {
      sellPromises = activeWallets.map(id => doSell(id, tokenAddr, `${pct}%`));
    } else {
      sellPromises = activeWallets.map(async (id) => {
        const bal = state.tokenBalances.get(id) || 0n;
        if (bal <= 0n) throw new Error('余额为零');
        const amt = (bal * BigInt(pct)) / 100n;
        const amountStr = formatUnits(amt, state.tokenInfo.decimals);
        return doSell(id, tokenAddr, amountStr);
      });
    }
    const results = await Promise.allSettled(sellPromises);
    const elapsed = ((performance.now() - batchT0) / 1000).toFixed(2);
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) { showStatus(`✓ 卖出成功 ${elapsed}s`, 'success'); showToast(`⚡ 卖出 ${pct}% 成功`, 'success'); }
    else if (ok > 0) { showStatus(`成功 ${ok} / 失败 ${fail}`, 'error'); }
    else { showStatus('卖出全部失败', 'error'); showToast('❌ 卖出失败', 'error'); }
    await loadBalances();
    await detectToken(tokenAddr);
  } catch (e) { showStatus('快速卖出失败: ' + e.message, 'error'); }
}
