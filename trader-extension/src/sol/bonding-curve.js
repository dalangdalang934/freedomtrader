import { Buffer } from 'buffer';
import { TransactionInstruction } from '@solana/web3.js';
import {
  PUMP_PROGRAM, PUMP_GLOBAL, PUMP_FEE, PUMP_FEE_RECIPIENTS,
  SYSTEM_PROGRAM, DISCRIMINATORS,
} from './constants.js';
import {
  deriveBondingCurve, deriveBondingCurveV2, deriveCreatorVault,
  deriveEventAuthority, deriveGlobalVolumeAccumulator,
  deriveUserVolumeAccumulator, deriveBcFeeConfig, deriveATA,
} from './pda.js';
import { getBcFeeConfig } from './accounts.js';

function randomFeeRecipient() {
  return PUMP_FEE_RECIPIENTS[Math.floor(Math.random() * PUMP_FEE_RECIPIENTS.length)];
}

function writeU64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function writeOptionBoolFalse() {
  // OptionBool { val: false } → 1 byte tag (1 = Some) + 1 byte value (0 = false)
  return Buffer.from([1, 0]);
}

export function calcBcBuyQuoteSync(spendableSolIn, bc, fee, slippagePct) {
  const totalFeeBps = fee.protocolFeeBps + fee.creatorFeeBps;
  const solIn = BigInt(spendableSolIn);

  let netSol = (solIn * 10000n) / (10000n + totalFeeBps);
  const protocolFee = (netSol * fee.protocolFeeBps + 9999n) / 10000n;
  const creatorFee = (netSol * fee.creatorFeeBps + 9999n) / 10000n;
  const fees = protocolFee + creatorFee;
  if (netSol + fees > solIn) {
    netSol -= (netSol + fees - solIn);
  }

  const effectiveSol = netSol - 1n;
  if (effectiveSol <= 0n) return { tokensOut: 0n, minTokensOut: 0n };

  const tokensOut = (effectiveSol * bc.virtualTokenReserves) /
    (bc.virtualSolReserves + effectiveSol);

  const slipBps = BigInt(Math.floor((100 - slippagePct) * 100));
  const minTokensOut = (tokensOut * slipBps) / 10000n;

  return { tokensOut, minTokensOut };
}

export async function calcBondingCurveBuyQuote(spendableSolIn, bc, slippagePct) {
  const fee = await getBcFeeConfig();
  return calcBcBuyQuoteSync(spendableSolIn, bc, fee, slippagePct);
}

export function calcBondingCurveSellQuote(tokenAmount, bc, feeConfig, slippagePct) {
  const amount = BigInt(tokenAmount);
  const grossSol = (amount * bc.virtualSolReserves) / (bc.virtualTokenReserves + amount);
  const protocolFee = (grossSol * feeConfig.protocolFeeBps + 9999n) / 10000n;
  const creatorFee = (grossSol * feeConfig.creatorFeeBps + 9999n) / 10000n;
  const netSol = grossSol - protocolFee - creatorFee;

  const slipBps = BigInt(Math.floor((100 - slippagePct) * 100));
  const minSolOut = (netSol * slipBps) / 10000n;

  return { netSol, minSolOut };
}

export function buildBondingCurveBuyIx(
  mint, user, bondingCurve, tokenProgram, spendableSolIn, minTokensOut
) {
  const data = Buffer.concat([
    DISCRIMINATORS.BUY_EXACT_SOL_IN,
    writeU64LE(spendableSolIn),
    writeU64LE(minTokensOut),
    writeOptionBoolFalse(),
  ]);

  const bcPda = deriveBondingCurve(mint);
  const bcV2Pda = deriveBondingCurveV2(mint);
  const associatedBc = deriveATA(bcPda, mint, tokenProgram);
  const associatedUser = deriveATA(user, mint, tokenProgram);
  const creatorVault = deriveCreatorVault(bondingCurve.creator);
  const eventAuth = deriveEventAuthority(PUMP_PROGRAM);
  const globalVolAcc = deriveGlobalVolumeAccumulator(PUMP_PROGRAM);
  const userVolAcc = deriveUserVolumeAccumulator(user, PUMP_PROGRAM);
  const feeConfig = deriveBcFeeConfig();

  const keys = [
    { pubkey: PUMP_GLOBAL,      isSigner: false, isWritable: false },  // 0  global
    { pubkey: randomFeeRecipient(), isSigner: false, isWritable: true },   // 1  fee_recipient
    { pubkey: mint,             isSigner: false, isWritable: false },  // 2  mint
    { pubkey: bcPda,            isSigner: false, isWritable: true },   // 3  bonding_curve
    { pubkey: associatedBc,     isSigner: false, isWritable: true },   // 4  associated_bonding_curve
    { pubkey: associatedUser,   isSigner: false, isWritable: true },   // 5  associated_user
    { pubkey: user,             isSigner: true,  isWritable: true },   // 6  user
    { pubkey: SYSTEM_PROGRAM,   isSigner: false, isWritable: false },  // 7  system_program
    { pubkey: tokenProgram,     isSigner: false, isWritable: false },  // 8  token_program
    { pubkey: creatorVault,     isSigner: false, isWritable: true },   // 9  creator_vault
    { pubkey: eventAuth,        isSigner: false, isWritable: false },  // 10 event_authority
    { pubkey: PUMP_PROGRAM,     isSigner: false, isWritable: false },  // 11 program
    { pubkey: globalVolAcc,     isSigner: false, isWritable: false },  // 12 global_volume_accumulator
    { pubkey: userVolAcc,       isSigner: false, isWritable: true },   // 13 user_volume_accumulator
    { pubkey: feeConfig,        isSigner: false, isWritable: false },  // 14 fee_config
    { pubkey: PUMP_FEE,         isSigner: false, isWritable: false },  // 15 fee_program
    { pubkey: bcV2Pda,          isSigner: false, isWritable: false },  // 16 bonding_curve_v2
  ];

  return new TransactionInstruction({ keys, programId: PUMP_PROGRAM, data });
}

export function buildBondingCurveSellIx(
  mint, user, bondingCurve, tokenProgram, tokenAmount, minSolOut
) {
  const data = Buffer.concat([
    DISCRIMINATORS.BC_SELL,
    writeU64LE(tokenAmount),
    writeU64LE(minSolOut),
  ]);

  const bcPda = deriveBondingCurve(mint);
  const bcV2Pda = deriveBondingCurveV2(mint);
  const associatedBc = deriveATA(bcPda, mint, tokenProgram);
  const associatedUser = deriveATA(user, mint, tokenProgram);
  const creatorVault = deriveCreatorVault(bondingCurve.creator);
  const eventAuth = deriveEventAuthority(PUMP_PROGRAM);
  const feeConfig = deriveBcFeeConfig();

  const keys = [
    { pubkey: PUMP_GLOBAL,      isSigner: false, isWritable: false },  // 0
    { pubkey: randomFeeRecipient(), isSigner: false, isWritable: true },   // 1
    { pubkey: mint,             isSigner: false, isWritable: false },  // 2
    { pubkey: bcPda,            isSigner: false, isWritable: true },   // 3
    { pubkey: associatedBc,     isSigner: false, isWritable: true },   // 4
    { pubkey: associatedUser,   isSigner: false, isWritable: true },   // 5
    { pubkey: user,             isSigner: true,  isWritable: true },   // 6
    { pubkey: SYSTEM_PROGRAM,   isSigner: false, isWritable: false },  // 7
    { pubkey: creatorVault,     isSigner: false, isWritable: true },   // 8
    { pubkey: tokenProgram,     isSigner: false, isWritable: false },  // 9
    { pubkey: eventAuth,        isSigner: false, isWritable: false },  // 10
    { pubkey: PUMP_PROGRAM,     isSigner: false, isWritable: false },  // 11
    { pubkey: feeConfig,        isSigner: false, isWritable: false },  // 12
    { pubkey: PUMP_FEE,         isSigner: false, isWritable: false },  // 13
    { pubkey: bcV2Pda,          isSigner: false, isWritable: false },  // 14
  ];

  return new TransactionInstruction({ keys, programId: PUMP_PROGRAM, data });
}
