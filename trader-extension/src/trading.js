import { parseUnits } from 'viem';
import { FREEDOM_ROUTER, ROUTER_ABI, ERC20_ABI, TOKEN_MANAGER_V2, HELPER3, ZERO_ADDR, DEFAULT_TIP_RATE } from './constants.js';
import { state } from './state.js';
import { $ } from './utils.js';

const APPROVE_KEY = 'approvedTokens';

function markApproved(key) {
  state.approvedTokens.add(key);
  chrome.storage.local.set({ [APPROVE_KEY]: [...state.approvedTokens] });
}

export async function loadApprovedTokens() {
  const data = await chrome.storage.local.get([APPROVE_KEY]);
  const saved = data[APPROVE_KEY];
  if (Array.isArray(saved)) saved.forEach(k => state.approvedTokens.add(k));
  console.log(`[APPROVE] 已加载 ${state.approvedTokens.size} 条授权缓存`);
}

export function getSellApproveTarget() {
  if (state.lpInfo.isInternal) {
    return (!state.lpInfo.tmQuote || state.lpInfo.tmQuote === ZERO_ADDR) ? TOKEN_MANAGER_V2 : HELPER3;
  }
  return FREEDOM_ROUTER;
}

export function getTipRate() {
  const raw = (state.config.tipRate != null && state.config.tipRate !== '') ? Number(state.config.tipRate) : DEFAULT_TIP_RATE;
  const pct = Math.max(0, Math.min(5, raw));
  return BigInt(Math.floor(pct * 100));
}

export async function refreshTipConfig() {
  const c = await chrome.storage.local.get(['tipRate']);
  if (c.tipRate != null) state.config.tipRate = c.tipRate;
}

export function calcAmountOutMin(amountIn, reserveIn, reserveOut, decimalsOut, slippage) {
  if (reserveIn <= 0n || reserveOut <= 0n) {
    console.warn('[滑点] 储备为零，跳过本地滑点保护，由合约处理');
    return 0n;
  }
  const amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
  const slipBps = BigInt(Math.floor((100 - slippage) * 100));
  return (amountOut * slipBps) / 10000n;
}

export async function buy(walletId, tokenAddr, amountStr, gasPrice) {
  const wc = state.walletClients.get(walletId);
  if (!wc) throw new Error('钱包未初始化');
  await refreshTipConfig();

  const amt = parseUnits(amountStr, 18);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  const tipRate = getTipRate();
  const slippage = parseFloat($('slippage')?.value) || 15;
  const amountOutMin = calcAmountOutMin(amt, state.lpInfo.reserveBNB, state.lpInfo.reserveToken, state.tokenInfo.decimals, slippage);

  const t0 = performance.now();
  console.log('[BUY] token:', tokenAddr, 'amount:', amountStr, 'BNB, tipRate:', tipRate.toString());

  const txHash = await wc.client.writeContract({
    address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'buy',
    args: [tokenAddr, amountOutMin, deadline, tipRate],
    value: amt, gas: 800000n, gasPrice: parseUnits(gasPrice.toString(), 9)
  });

  const tSent = performance.now();
  console.log(`[BUY] txHash: ${txHash} | 发送耗时: ${((tSent - t0) / 1000).toFixed(2)}s`);

  const receipt = await state.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120000 });
  const tConfirm = performance.now();

  if (receipt.status !== 'success') throw new Error('交易失败: ' + txHash);
  console.log(`[BUY] ✓ 确认 | 等待: ${((tConfirm - tSent) / 1000).toFixed(2)}s | 总计: ${((tConfirm - t0) / 1000).toFixed(2)}s`);

  const sellTarget = getSellApproveTarget();
  const approveKey = `${wc.account.address}:${tokenAddr}:${sellTarget}`.toLowerCase();
  if (!state.approvedTokens.has(approveKey)) {
    try {
      const allowance = await state.publicClient.readContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: 'allowance',
        args: [wc.account.address, sellTarget]
      });
      const MAX_HALF = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      if (allowance >= MAX_HALF) {
        console.log('[BUY] 已有足够授权，跳过 approve');
      } else {
        const approveTx = await wc.client.writeContract({
          address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
          args: [sellTarget, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
          gas: 150000n, gasPrice: parseUnits(gasPrice.toString(), 9)
        });
        console.log('[BUY] 自动 approve 给', sellTarget, ':', approveTx);
      }
      markApproved(approveKey);
    } catch (e) { console.warn('[BUY] 自动 approve 失败:', e.message); }
  } else {
    console.log('[BUY] 缓存命中，跳过 approve');
  }

  return { txHash, sendMs: tSent - t0, confirmMs: tConfirm - tSent, totalMs: tConfirm - t0 };
}

export async function sell(walletId, tokenAddr, amountStr, gasPrice) {
  const wc = state.walletClients.get(walletId);
  if (!wc) throw new Error('钱包未初始化');
  await refreshTipConfig();

  let amt = parseUnits(amountStr, state.tokenInfo.decimals);
  if (state.lpInfo.isInternal && state.tokenInfo.decimals >= 9) {
    const GW = 10n ** 9n;
    amt = (amt / GW) * GW;
  }
  if (amt <= 0n) throw new Error('数量太小');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  const tipRate = getTipRate();
  const slippage = parseFloat($('slippage')?.value) || 15;
  const amountOutMin = calcAmountOutMin(amt, state.lpInfo.reserveToken, state.lpInfo.reserveBNB, 18, slippage);

  const balance = await state.publicClient.readContract({
    address: tokenAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [wc.account.address]
  });
  if (balance < amt) throw new Error('代币余额不足');

  const approveTarget = getSellApproveTarget();
  const approveKey = `${wc.account.address}:${tokenAddr}:${approveTarget}`.toLowerCase();
  if (!state.approvedTokens.has(approveKey)) {
    const allowance = await state.publicClient.readContract({
      address: tokenAddr, abi: ERC20_ABI, functionName: 'allowance', args: [wc.account.address, approveTarget]
    });

    if (allowance < amt) {
      console.log('[SELL] approve 给', approveTarget);
      const approveTx = await wc.client.writeContract({
        address: tokenAddr, abi: ERC20_ABI, functionName: 'approve',
        args: [approveTarget, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        gas: 150000n, gasPrice: parseUnits(gasPrice.toString(), 9)
      });
      await state.publicClient.waitForTransactionReceipt({ hash: approveTx });
    }
    markApproved(approveKey);
  }

  const t0 = performance.now();
  console.log('[SELL] token:', tokenAddr, 'amount:', amountStr, 'tipRate:', tipRate.toString());

  const txHash = await wc.client.writeContract({
    address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'sell',
    args: [tokenAddr, amt, amountOutMin, deadline, tipRate],
    gas: 800000n, gasPrice: parseUnits(gasPrice.toString(), 9)
  });

  const tSent = performance.now();
  console.log(`[SELL] txHash: ${txHash} | 发送耗时: ${((tSent - t0) / 1000).toFixed(2)}s`);

  const receipt = await state.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120000 });
  const tConfirm = performance.now();

  if (receipt.status !== 'success') throw new Error('交易失败: ' + txHash);
  console.log(`[SELL] ✓ 确认 | 等待: ${((tConfirm - tSent) / 1000).toFixed(2)}s | 总计: ${((tConfirm - t0) / 1000).toFixed(2)}s`);

  return { txHash, sendMs: tSent - t0, confirmMs: tConfirm - tSent, totalMs: tConfirm - t0 };
}
