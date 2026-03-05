import {
  Keypair, PublicKey, Transaction, ComputeBudgetProgram, SystemProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnection, getBlockhashFast } from './connection.js';
import { LAMPORTS_PER_SOL, DEFAULT_COMPUTE_UNITS, DEFAULT_PRIORITY_FEE_LAMPORTS, WSOL_MINT, SPL_TOKEN_PROGRAM, SOL_TIP_RECIPIENT, DEFAULT_SOL_TIP_BPS, JITO_TIP_ACCOUNTS, JITO_BLOCK_ENGINES, DEFAULT_JITO_TIP_LAMPORTS } from './constants.js';
import { getBondingCurve, getBcFeeConfig, getTokenProgram, getTokenBalance, getPoolReserves, getAmmGlobalConfig, warmDynamicFeeConfig, getAmmDynamicFeesSync } from './accounts.js';
import { deriveATA } from './pda.js';
import {
  calcBcBuyQuoteSync, calcBondingCurveSellQuote,
  buildBondingCurveBuyIx, buildBondingCurveSellIx,
} from './bonding-curve.js';
import {
  findPoolForMint, calcAmmBuyQuote, calcAmmSellQuote,
  buildPumpSwapBuyIx, buildPumpSwapSellIx,
  buildWrapSolInstructions, buildCloseWsolIx,
  buildCreateBaseATAIx,
} from './pump-swap.js';

export function loadKeypair(privateKeyBase58) {
  return Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
}

function buildPriorityFeeIxs(computeUnits, priorityFeeLamports) {
  const cu = computeUnits || DEFAULT_COMPUTE_UNITS;
  const microLamports = Math.floor((priorityFeeLamports || DEFAULT_PRIORITY_FEE_LAMPORTS) * 1_000_000 / cu);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

function buildTipIx(user, solAmount, tipBps) {
  const bps = BigInt(tipBps);
  if (bps <= 0n) return null;
  const lamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
  const tipLamports = (lamports * bps) / 10000n;
  if (tipLamports <= 0n) return null;
  return SystemProgram.transfer({
    fromPubkey: user,
    toPubkey: SOL_TIP_RECIPIENT,
    lamports: tipLamports,
  });
}

export async function detectToken(mintAddress) {
  const mint = new PublicKey(mintAddress);

  const [bc, tokenProgram] = await Promise.all([
    getBondingCurve(mint),
    getTokenProgram(mint),
  ]);

  if (!bc) return null;

  const isToken2022 = !tokenProgram.equals(SPL_TOKEN_PROGRAM);

  if (!bc.complete) {
    await getBcFeeConfig().catch(() => {});

    return {
      type: 'bonding-curve',
      mint,
      bondingCurve: bc,
      tokenProgram,
      isToken2022,
      virtualSolReserves: bc.virtualSolReserves,
      virtualTokenReserves: bc.virtualTokenReserves,
      realSolReserves: bc.realSolReserves,
      realTokenReserves: bc.realTokenReserves,
      complete: false,
      creator: bc.creator,
      isMayhemMode: bc.isMayhemMode,
    };
  }

  const [pool] = await Promise.all([
    findPoolForMint(mint),
    getAmmGlobalConfig().catch(() => {}),
    warmDynamicFeeConfig().catch(() => {}),
  ]);

  if (!pool) {
    return {
      type: 'completed-no-pool',
      mint,
      bondingCurve: bc,
      tokenProgram,
      isToken2022,
      complete: true,
    };
  }

  return {
    type: 'pumpswap',
    mint,
    bondingCurve: bc,
    pool,
    tokenProgram,
    isToken2022,
    complete: true,
  };
}

export async function buy(keypair, mintAddress, solAmount, slippagePct, opts = {}) {
  const conn = getConnection();
  const mint = new PublicKey(mintAddress);
  const lamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
  const user = keypair.publicKey;

  const t0 = performance.now();

  const cached = opts.detectResult;
  const blockhashPromise = getBlockhashFast();

  const tpPromise = cached?.tokenProgram ? null : getTokenProgram(mint);
  const bcPromise = cached?.bondingCurve ? null : getBondingCurve(mint);
  if (tpPromise || bcPromise) await Promise.all([tpPromise, bcPromise, blockhashPromise].filter(Boolean));

  const tokenProgram = cached?.tokenProgram || await tpPromise;
  const bc = cached?.bondingCurve || await bcPromise;
  if (!bc) throw new Error('Not a Pump.fun token');

  let instructions = [];
  instructions.push(...buildPriorityFeeIxs(opts.computeUnits, opts.priorityFeeLamports));

  if (!bc.complete) {
    const feeConfig = await getBcFeeConfig();
    const { minTokensOut, tokensOut } = calcBcBuyQuoteSync(lamports, bc, feeConfig, slippagePct);
    console.log(`[BC-BUY] ${solAmount} SOL → ~${tokensOut} tokens (min: ${minTokensOut})`);

    const { ix: createUserAta } = buildCreateBaseATAIx(user, mint, tokenProgram);
    instructions.push(createUserAta);

    const buyIx = buildBondingCurveBuyIx(mint, user, bc, tokenProgram, lamports, minTokensOut);
    instructions.push(buyIx);
  } else {
    const pool = cached?.pool || await findPoolForMint(mint);
    if (!pool) throw new Error('Pool not found for graduated token');

    const [{ baseReserve, quoteReserve }, globalConfig] = await Promise.all([
      getPoolReserves(pool),
      getAmmGlobalConfig(),
      warmDynamicFeeConfig(),
    ]);

    const { totalFeeBps } = getAmmDynamicFeesSync(baseReserve, quoteReserve);
    const { baseOut, maxQuoteIn } = calcAmmBuyQuote(lamports, baseReserve, quoteReserve, totalFeeBps, slippagePct);
    console.log(`[AMM-BUY] ${solAmount} SOL → ~${baseOut} tokens (maxQuoteIn: ${maxQuoteIn}, fee: ${totalFeeBps}bps)`);

    const wsolAta = deriveATA(user, WSOL_MINT, SPL_TOKEN_PROGRAM);
    instructions.push(...buildWrapSolInstructions(user, maxQuoteIn, wsolAta));

    const { ix: createBaseAta } = buildCreateBaseATAIx(user, pool.baseMint, tokenProgram);
    instructions.push(createBaseAta);

    const buyIx = buildPumpSwapBuyIx(user, pool, tokenProgram, globalConfig, baseOut, maxQuoteIn);
    instructions.push(buyIx);

    instructions.push(buildCloseWsolIx(user, wsolAta));
  }

  const tipBps = opts.tipBps != null ? opts.tipBps : DEFAULT_SOL_TIP_BPS;
  const tipIx = buildTipIx(user, solAmount, tipBps);
  if (tipIx) instructions.push(tipIx);

  return signSendConfirm(conn, instructions, keypair, t0, {
    jitoTipLamports: opts.jitoTipLamports,
    blockhashPromise,
  });
}

export async function sell(keypair, mintAddress, tokenAmountOrPercent, slippagePct, opts = {}) {
  const conn = getConnection();
  const mint = new PublicKey(mintAddress);
  const user = keypair.publicKey;

  const t0 = performance.now();

  const cached = opts.detectResult;
  const blockhashPromise = getBlockhashFast();

  const isPct = typeof tokenAmountOrPercent === 'string' && tokenAmountOrPercent.endsWith('%');
  const bcPromise = cached?.bondingCurve ? null : getBondingCurve(mint);

  const tokenProgram = cached?.tokenProgram || await getTokenProgram(mint);

  const balPromise = isPct ? getTokenBalance(user, mint, tokenProgram) : null;
  await Promise.all([bcPromise, balPromise, blockhashPromise].filter(Boolean));

  const bc = cached?.bondingCurve || await bcPromise;
  const balance = isPct ? await balPromise : undefined;
  if (!bc) throw new Error('Not a Pump.fun token');

  let sellAmount;
  if (isPct) {
    if (balance <= 0n) throw new Error('Token balance is 0');
    sellAmount = (balance * BigInt(parseInt(tokenAmountOrPercent))) / 100n;
  } else {
    sellAmount = BigInt(tokenAmountOrPercent);
  }

  if (sellAmount <= 0n) throw new Error('Sell amount must be > 0');

  let instructions = [];
  instructions.push(...buildPriorityFeeIxs(opts.computeUnits, opts.priorityFeeLamports));

  let guaranteedSolOut = 0n;

  if (!bc.complete) {
    const feeConfig = await getBcFeeConfig();
    const { minSolOut, netSol } = calcBondingCurveSellQuote(sellAmount, bc, feeConfig, slippagePct);
    console.log(`[BC-SELL] ${sellAmount} tokens → ~${netSol} lamports (min: ${minSolOut})`);
    guaranteedSolOut = minSolOut;

    const sellIx = buildBondingCurveSellIx(mint, user, bc, tokenProgram, sellAmount, minSolOut);
    instructions.push(sellIx);
  } else {
    const pool = cached?.pool || await findPoolForMint(mint);
    if (!pool) throw new Error('Pool not found');

    const [{ baseReserve, quoteReserve }, globalConfig] = await Promise.all([
      getPoolReserves(pool),
      getAmmGlobalConfig(),
      warmDynamicFeeConfig(),
    ]);

    const { totalFeeBps } = getAmmDynamicFeesSync(baseReserve, quoteReserve);
    const { minQuoteOut, netQuote } = calcAmmSellQuote(sellAmount, baseReserve, quoteReserve, totalFeeBps, slippagePct);
    console.log(`[AMM-SELL] ${sellAmount} tokens → ~${netQuote} lamports (min: ${minQuoteOut}, fee: ${totalFeeBps}bps)`);
    guaranteedSolOut = minQuoteOut;

    const wsolAta = deriveATA(user, WSOL_MINT, SPL_TOKEN_PROGRAM);
    instructions.push(buildWrapSolInstructions(user, 0n, wsolAta)[0]);

    const sellIx = buildPumpSwapSellIx(user, pool, tokenProgram, globalConfig, sellAmount, minQuoteOut);
    instructions.push(sellIx);

    instructions.push(buildCloseWsolIx(user, wsolAta));
  }

  const tipBps = BigInt(opts.tipBps != null ? opts.tipBps : DEFAULT_SOL_TIP_BPS);
  if (tipBps > 0n && guaranteedSolOut > 0n) {
    const tipLamports = (guaranteedSolOut * tipBps) / 10000n;
    if (tipLamports > 0n) {
      instructions.push(SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: SOL_TIP_RECIPIENT,
        lamports: tipLamports,
      }));
    }
  }

  return signSendConfirm(conn, instructions, keypair, t0, {
    jitoTipLamports: opts.jitoTipLamports,
    blockhashPromise,
  });
}

function buildJitoTipIx(user, lamports) {
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return SystemProgram.transfer({ fromPubkey: user, toPubkey: tipAccount, lamports: BigInt(lamports) });
}

async function sendToJito(rawBase64) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'sendTransaction',
    params: [rawBase64, { encoding: 'base64' }],
  });
  const results = await Promise.allSettled(
    JITO_BLOCK_ENGINES.map(url =>
      fetch(`${url}/api/v1/transactions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }).then(r => r.json())
    )
  );
  let accepted = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.result) accepted++;
  }
  console.log(`[JITO] Broadcast to ${JITO_BLOCK_ENGINES.length} engines, ${accepted} accepted`);
}

function formatTxError(err) {
  const s = JSON.stringify(err);
  if (s.includes('InsufficientFundsForRent')) return 'SOL 余额不足（不够支付 rent）';
  if (s.includes('"Custom":1}')) return 'SOL/Token 余额不足';
  if (s.includes('"Custom":6004')) return '滑点超限 (Slippage)，请提高滑点';
  if (s.includes('"Custom":3007')) return '账户所属程序不匹配 (AccountOwnedByWrongProgram)';
  if (s.includes('"Custom":6000')) return '代币已毕业，请重新检测';
  return `交易失败: ${s}`;
}

async function pollConfirmation(conn, sig, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: false });
    if (st?.value) {
      if (st.value.err) throw new Error(formatTxError(st.value.err));
      if (st.value.confirmationStatus === 'confirmed' || st.value.confirmationStatus === 'finalized') {
        return st.value.slot;
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Transaction confirmation timeout');
}

async function confirmWithFallback(conn, sig, timeoutMs = 60000) {
  let wsSubId;
  let settled = false;

  const wsPromise = new Promise((resolve, reject) => {
    try {
      wsSubId = conn.onSignature(sig, (result, ctx) => {
        if (settled) return;
        settled = true;
        if (result.err) reject(new Error(formatTxError(result.err)));
        else resolve(ctx.slot);
      }, 'confirmed');
    } catch {
      // WS unavailable — poll will handle it
    }
  });

  const pollPromise = pollConfirmation(conn, sig, timeoutMs);

  try {
    const slot = await Promise.race([wsPromise, pollPromise].filter(Boolean));
    settled = true;
    return slot;
  } finally {
    if (wsSubId != null) {
      try { conn.removeSignatureListener(wsSubId); } catch {}
    }
  }
}

async function getBlockTime(conn, sig) {
  try {
    const tx = await conn.getTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.blockTime) return tx.blockTime;
  } catch (_) {}
  return null;
}

async function signSendConfirm(conn, instructions, keypair, t0, opts = {}) {
  const jitoTip = opts.jitoTipLamports || DEFAULT_JITO_TIP_LAMPORTS;
  if (jitoTip > 0) {
    instructions.push(buildJitoTipIx(keypair.publicKey, jitoTip));
  }

  const tx = new Transaction().add(...instructions);
  const { blockhash } = opts.blockhashPromise
    ? await opts.blockhashPromise
    : await getBlockhashFast();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;

  const tBuild = performance.now();
  console.log(`[TX] Build: ${((tBuild - t0) / 1000).toFixed(2)}s`);

  tx.sign(keypair);
  const raw = tx.serialize();
  const rawBase64 = raw.toString('base64');

  const sendEpoch = Math.floor(Date.now() / 1000);
  const [sig] = await Promise.all([
    conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 2 }),
    sendToJito(rawBase64),
  ]);

  const tSent = performance.now();
  console.log(`[TX] Sent: ${sig} (send ${((tSent - tBuild) / 1000).toFixed(2)}s, Jito tip: ${jitoTip} lamports)`);

  const slot = await confirmWithFallback(conn, sig);

  const tDone = performance.now();
  const confirmMs = tDone - tSent;
  const elapsed = tDone - t0;

  getBlockTime(conn, sig).then(bt => {
    const chainSec = bt ? bt - sendEpoch : null;
    const label = chainSec != null ? `${chainSec}s (链上)` : `${(confirmMs / 1000).toFixed(2)}s (轮询)`;
    console.log(`[TX] Confirmed: ${sig} slot=${slot} | total ${(elapsed / 1000).toFixed(2)}s (build ${((tBuild - t0) / 1000).toFixed(2)}s + send ${((tSent - tBuild) / 1000).toFixed(2)}s + confirm ${label})`);
  });

  return { signature: sig, buildMs: tBuild - t0, sendMs: tSent - tBuild, confirmMs, elapsed, slot };
}
