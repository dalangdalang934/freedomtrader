import { state } from './state.js';
import { getConnection } from './sol/connection.js';
import { detectToken, buy, sell } from './sol/trading.js';

function ensureConnection() {
  const conn = getConnection();
  if (!conn) throw new Error('SOL RPC 未初始化，请检查设置');
  return conn;
}

function getSolTipBps() {
  const rate = state.config.tipRate;
  if (rate == null || rate === '' || rate === 0) return 0;
  const pct = Math.max(0, Math.min(5, Number(rate)));
  return Math.floor(pct * 100);
}

export async function solDetectToken(mintAddress) {
  ensureConnection();
  return detectToken(mintAddress);
}

function getCachedDetectResult() {
  return state.lpInfo?.solDetectResult || null;
}

export async function solBuy(walletId, mintAddr, solAmount, slippage, opts = {}) {
  ensureConnection();
  const publicKey = state.solAddresses.get(walletId);
  if (!publicKey) throw new Error('SOL 钱包未初始化');

  const priorityFee = opts.priorityFee ?? state.solConfig.priorityFee ?? 100000;
  const jitoTip = opts.jitoTip ?? state.solConfig.jitoTip ?? 100000;

  const result = await buy(walletId, publicKey, mintAddr, solAmount, slippage, {
    priorityFeeLamports: priorityFee,
    computeUnits: 200000,
    tipBps: getSolTipBps(),
    jitoTipLamports: jitoTip,
    detectResult: getCachedDetectResult(),
  });

  return {
    txHash: result.signature,
    buildMs: result.buildMs,
    sendMs: result.sendMs,
    confirmMs: result.confirmMs,
    totalMs: result.elapsed,
  };
}

export async function solSell(walletId, mintAddr, amountOrPct, slippage, opts = {}) {
  ensureConnection();
  const publicKey = state.solAddresses.get(walletId);
  if (!publicKey) throw new Error('SOL 钱包未初始化');

  const priorityFee = opts.priorityFee ?? state.solConfig.priorityFee ?? 100000;
  const jitoTip = opts.jitoTip ?? state.solConfig.jitoTip ?? 100000;

  const result = await sell(walletId, publicKey, mintAddr, amountOrPct, slippage, {
    priorityFeeLamports: priorityFee,
    computeUnits: 200000,
    tipBps: getSolTipBps(),
    jitoTipLamports: jitoTip,
    detectResult: getCachedDetectResult(),
  });

  return {
    txHash: result.signature,
    buildMs: result.buildMs,
    sendMs: result.sendMs,
    confirmMs: result.confirmMs,
    totalMs: result.elapsed,
  };
}
