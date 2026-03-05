import { Buffer } from 'buffer';
import { TransactionInstruction, SystemProgram } from '@solana/web3.js';
import {
  PUMP_AMM, PUMP_AMM_GLOBAL_CONFIG, PUMP_FEE, WSOL_MINT,
  SPL_TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM,
  DISCRIMINATORS,
} from './constants.js';
import {
  derivePoolAuthority, derivePool, derivePoolV2,
  deriveEventAuthority, deriveAmmCreatorVault, deriveAmmFeeConfig,
  deriveATA, deriveGlobalVolumeAccumulator, deriveUserVolumeAccumulator,
} from './pda.js';
import { getAmmGlobalConfig, getPool, getPoolReserves, getTokenProgram } from './accounts.js';
import { getConnection } from './connection.js';

function writeU64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function writeOptionBoolFalse() {
  return Buffer.from([1, 0]);
}

export async function findPoolForMint(mint) {
  const poolAuth = derivePoolAuthority(mint);
  const poolPda = derivePool(poolAuth, mint, WSOL_MINT);
  const pool = await getPool(poolPda);
  if (pool) return pool;

  // Fallback: search by program accounts with filter.
  // Some RPC providers (e.g. GetBlock) reject getProgramAccounts — catch gracefully.
  try {
    const conn = getConnection();
    const accounts = await conn.getProgramAccounts(PUMP_AMM, {
      filters: [
        { memcmp: { offset: 8 + 35, bytes: mint.toBase58() } },
      ],
    });

    if (accounts.length > 0) {
      const { parsePool } = await import('./accounts.js');
      const parsed = parsePool(accounts[0].account.data);
      return { ...parsed, address: accounts[0].pubkey };
    }
  } catch (e) {
    console.warn('[findPoolForMint] getProgramAccounts fallback failed:', e.message);
  }

  return null;
}

export function calcAmmBuyQuote(spendableQuoteIn, baseReserve, quoteReserve, totalFeeBps, slippagePct) {
  const quoteIn = BigInt(spendableQuoteIn);
  const feeBps = totalFeeBps || 125n;

  const netQuote = (quoteIn * 10000n) / (10000n + feeBps);

  // constant product: baseOut = netQuote * baseReserve / (quoteReserve + netQuote)
  const baseOut = (netQuote * baseReserve) / (quoteReserve + netQuote);

  // AMM buy = (base_amount_out, max_quote_amount_in)
  // Slippage DOWN on baseOut (accept fewer tokens)
  const slipDownBps = BigInt(Math.floor((100 - slippagePct) * 100));
  const minBaseOut = (baseOut * slipDownBps) / 10000n;

  // Slippage UP on maxQuoteIn (allow paying more)
  const slipUpBps = BigInt(Math.floor((100 + slippagePct) * 100));
  const maxQuoteIn = (quoteIn * slipUpBps) / 10000n;

  return { baseOut: minBaseOut, maxQuoteIn };
}

export function calcAmmSellQuote(baseAmountIn, baseReserve, quoteReserve, totalFeeBps, slippagePct) {
  const amountIn = BigInt(baseAmountIn);
  const grossQuote = (amountIn * quoteReserve) / (baseReserve + amountIn);

  const feeBps = totalFeeBps || 125n;
  const fee = (grossQuote * feeBps) / 10000n;
  const netQuote = grossQuote - fee;

  const slipBps = BigInt(Math.floor((100 - slippagePct) * 100));
  const minQuoteOut = (netQuote * slipBps) / 10000n;

  return { netQuote, minQuoteOut };
}

// Create WSOL ATA + transfer + syncNative
export function buildWrapSolInstructions(user, lamports, wsolAta) {
  const instructions = [];

  // Create ATA if not exists (idempotent)
  instructions.push(createATAIdempotentIx(user, WSOL_MINT, SPL_TOKEN_PROGRAM, wsolAta));

  // Transfer SOL
  instructions.push(SystemProgram.transfer({
    fromPubkey: user,
    toPubkey: wsolAta,
    lamports: BigInt(lamports),
  }));

  // SyncNative
  const syncData = Buffer.alloc(1);
  syncData.writeUInt8(17); // SyncNative instruction index
  instructions.push(new TransactionInstruction({
    keys: [{ pubkey: wsolAta, isSigner: false, isWritable: true }],
    programId: SPL_TOKEN_PROGRAM,
    data: syncData,
  }));

  return instructions;
}

export function buildCloseWsolIx(user, wsolAta) {
  // CloseAccount instruction index = 9
  const data = Buffer.alloc(1);
  data.writeUInt8(9);
  return new TransactionInstruction({
    keys: [
      { pubkey: wsolAta, isSigner: false, isWritable: true },
      { pubkey: user,    isSigner: false, isWritable: true },
      { pubkey: user,    isSigner: true,  isWritable: false },
    ],
    programId: SPL_TOKEN_PROGRAM,
    data,
  });
}

function createATAIdempotentIx(owner, mint, tokenProgram, ata) {
  return new TransactionInstruction({
    keys: [
      { pubkey: owner,                    isSigner: true,  isWritable: true },
      { pubkey: ata,                      isSigner: false, isWritable: true },
      { pubkey: owner,                    isSigner: false, isWritable: false },
      { pubkey: mint,                     isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM,           isSigner: false, isWritable: false },
      { pubkey: tokenProgram,             isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM,
    // ATA create_idempotent = instruction index 1
    data: Buffer.from([1]),
  });
}

export function buildCreateBaseATAIx(user, baseMint, baseTokenProgram) {
  const ata = deriveATA(user, baseMint, baseTokenProgram);
  return {
    ix: createATAIdempotentIx(user, baseMint, baseTokenProgram, ata),
    ata,
  };
}

export function buildPumpSwapBuyIx(
  user, pool, baseTokenProgram, globalConfig,
  baseAmountOut, maxQuoteAmountIn
) {
  const data = Buffer.concat([
    DISCRIMINATORS.AMM_BUY,
    writeU64LE(baseAmountOut),
    writeU64LE(maxQuoteAmountIn),
    writeOptionBoolFalse(),
  ]);

  const userBaseAta = deriveATA(user, pool.baseMint, baseTokenProgram);
  const userQuoteAta = deriveATA(user, WSOL_MINT, SPL_TOKEN_PROGRAM);

  const feeRecipient = globalConfig.feeRecipients.length > 0
    ? globalConfig.feeRecipients[Math.floor(Math.random() * globalConfig.feeRecipients.length)]
    : user;
  const feeRecipientAta = deriveATA(feeRecipient, WSOL_MINT, SPL_TOKEN_PROGRAM);

  const eventAuth = deriveEventAuthority(PUMP_AMM);
  const creatorVaultAuth = deriveAmmCreatorVault(pool.coinCreator);
  const creatorVaultAta = deriveATA(creatorVaultAuth, WSOL_MINT, SPL_TOKEN_PROGRAM);
  const globalVolAcc = deriveGlobalVolumeAccumulator();
  const userVolAcc = deriveUserVolumeAccumulator(user);
  const feeConfig = deriveAmmFeeConfig();
  const poolV2 = derivePoolV2(pool.baseMint);

  const keys = [
    { pubkey: pool.address,          isSigner: false, isWritable: true },   // 0  pool
    { pubkey: user,                  isSigner: true,  isWritable: true },   // 1  user
    { pubkey: PUMP_AMM_GLOBAL_CONFIG, isSigner: false, isWritable: false }, // 2  global_config
    { pubkey: pool.baseMint,         isSigner: false, isWritable: false },  // 3  base_mint
    { pubkey: WSOL_MINT,             isSigner: false, isWritable: false },  // 4  quote_mint
    { pubkey: userBaseAta,           isSigner: false, isWritable: true },   // 5  user_base_token_account
    { pubkey: userQuoteAta,          isSigner: false, isWritable: true },   // 6  user_quote_token_account
    { pubkey: pool.baseTokenAccount, isSigner: false, isWritable: true },   // 7  pool_base_token_account
    { pubkey: pool.quoteTokenAccount, isSigner: false, isWritable: true },  // 8  pool_quote_token_account
    { pubkey: feeRecipient,          isSigner: false, isWritable: false },  // 9  protocol_fee_recipient
    { pubkey: feeRecipientAta,       isSigner: false, isWritable: true },   // 10 protocol_fee_recipient_token_account
    { pubkey: baseTokenProgram,      isSigner: false, isWritable: false },  // 11 base_token_program
    { pubkey: SPL_TOKEN_PROGRAM,     isSigner: false, isWritable: false },  // 12 quote_token_program
    { pubkey: SYSTEM_PROGRAM,        isSigner: false, isWritable: false },  // 13 system_program
    { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false }, // 14 associated_token_program
    { pubkey: eventAuth,             isSigner: false, isWritable: false },  // 15 event_authority
    { pubkey: PUMP_AMM,              isSigner: false, isWritable: false },  // 16 program
    { pubkey: creatorVaultAta,       isSigner: false, isWritable: true },   // 17 coin_creator_vault_ata
    { pubkey: creatorVaultAuth,      isSigner: false, isWritable: false },  // 18 coin_creator_vault_authority
    { pubkey: globalVolAcc,          isSigner: false, isWritable: true },   // 19 global_volume_accumulator
    { pubkey: userVolAcc,            isSigner: false, isWritable: true },   // 20 user_volume_accumulator
    { pubkey: feeConfig,             isSigner: false, isWritable: false },  // 21 fee_config
    { pubkey: PUMP_FEE,              isSigner: false, isWritable: false },  // 22 fee_program
    { pubkey: poolV2,                isSigner: false, isWritable: false },  // 23 pool_v2 (remaining)
  ];

  return new TransactionInstruction({ keys, programId: PUMP_AMM, data });
}

export function buildPumpSwapSellIx(
  user, pool, baseTokenProgram, globalConfig,
  baseAmountIn, minQuoteOut
) {
  const data = Buffer.concat([
    DISCRIMINATORS.AMM_SELL,
    writeU64LE(baseAmountIn),
    writeU64LE(minQuoteOut),
  ]);

  const userBaseAta = deriveATA(user, pool.baseMint, baseTokenProgram);
  const userQuoteAta = deriveATA(user, WSOL_MINT, SPL_TOKEN_PROGRAM);

  const feeRecipient = globalConfig.feeRecipients.length > 0
    ? globalConfig.feeRecipients[Math.floor(Math.random() * globalConfig.feeRecipients.length)]
    : user;
  const feeRecipientAta = deriveATA(feeRecipient, WSOL_MINT, SPL_TOKEN_PROGRAM);

  const eventAuth = deriveEventAuthority(PUMP_AMM);
  const creatorVaultAuth = deriveAmmCreatorVault(pool.coinCreator);
  const creatorVaultAta = deriveATA(creatorVaultAuth, WSOL_MINT, SPL_TOKEN_PROGRAM);
  const feeConfig = deriveAmmFeeConfig();
  const poolV2 = derivePoolV2(pool.baseMint);

  const keys = [
    { pubkey: pool.address,          isSigner: false, isWritable: true },   // 0
    { pubkey: user,                  isSigner: true,  isWritable: true },   // 1
    { pubkey: PUMP_AMM_GLOBAL_CONFIG, isSigner: false, isWritable: false }, // 2
    { pubkey: pool.baseMint,         isSigner: false, isWritable: false },  // 3
    { pubkey: WSOL_MINT,             isSigner: false, isWritable: false },  // 4
    { pubkey: userBaseAta,           isSigner: false, isWritable: true },   // 5
    { pubkey: userQuoteAta,          isSigner: false, isWritable: true },   // 6
    { pubkey: pool.baseTokenAccount, isSigner: false, isWritable: true },   // 7
    { pubkey: pool.quoteTokenAccount, isSigner: false, isWritable: true },  // 8
    { pubkey: feeRecipient,          isSigner: false, isWritable: false },  // 9
    { pubkey: feeRecipientAta,       isSigner: false, isWritable: true },   // 10
    { pubkey: baseTokenProgram,      isSigner: false, isWritable: false },  // 11
    { pubkey: SPL_TOKEN_PROGRAM,     isSigner: false, isWritable: false },  // 12
    { pubkey: SYSTEM_PROGRAM,        isSigner: false, isWritable: false },  // 13
    { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false }, // 14
    { pubkey: eventAuth,             isSigner: false, isWritable: false },  // 15
    { pubkey: PUMP_AMM,              isSigner: false, isWritable: false },  // 16
    { pubkey: creatorVaultAta,       isSigner: false, isWritable: true },   // 17
    { pubkey: creatorVaultAuth,      isSigner: false, isWritable: false },  // 18
    { pubkey: feeConfig,             isSigner: false, isWritable: false },  // 19
    { pubkey: PUMP_FEE,              isSigner: false, isWritable: false },  // 20
    { pubkey: poolV2,                isSigner: false, isWritable: false },  // 21 pool_v2 (remaining)
  ];

  return new TransactionInstruction({ keys, programId: PUMP_AMM, data });
}
