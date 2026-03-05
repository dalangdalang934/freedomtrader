import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import {
  PUMP_PROGRAM, PUMP_AMM, PUMP_FEE,
  ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM,
} from './constants.js';

function findPDA(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

// Pre-compute seeds that are reused across calls
const SEED_BC        = Buffer.from('bonding-curve');
const SEED_BC_V2     = Buffer.from('bonding-curve-v2');
const SEED_CV        = Buffer.from('creator-vault');
const SEED_EA        = Buffer.from('__event_authority');
const SEED_GVA       = Buffer.from('global_volume_accumulator');
const SEED_UVA       = Buffer.from('user_volume_accumulator');
const SEED_FC        = Buffer.from('fee_config');
const SEED_PA        = Buffer.from('pool-authority');
const SEED_PV2       = Buffer.from('pool-v2');
const SEED_AMM_CV    = Buffer.from('creator_vault');
const SEED_POOL      = Buffer.from('pool');
const POOL_INDEX_BUF = (() => { const b = Buffer.alloc(2); b.writeUInt16LE(0); return b; })();

// Constant PDAs — computed once at module load, reused forever
const EVENT_AUTH_PUMP = findPDA([SEED_EA], PUMP_PROGRAM);
const EVENT_AUTH_AMM  = findPDA([SEED_EA], PUMP_AMM);
const GVA_PUMP       = findPDA([SEED_GVA], PUMP_PROGRAM);
const GVA_AMM        = findPDA([SEED_GVA], PUMP_AMM);
const BC_FEE_CONFIG  = findPDA([SEED_FC, PUMP_PROGRAM.toBuffer()], PUMP_FEE);
const AMM_FEE_CONFIG = findPDA([SEED_FC, PUMP_AMM.toBuffer()], PUMP_FEE);

// LRU-ish cache for per-key PDA derivations
const _pdaCache = new Map();
const PDA_CACHE_MAX = 256;
function cachedPDA(cacheKey, seeds, programId) {
  let val = _pdaCache.get(cacheKey);
  if (val) return val;
  val = findPDA(seeds, programId);
  if (_pdaCache.size >= PDA_CACHE_MAX) {
    const first = _pdaCache.keys().next().value;
    _pdaCache.delete(first);
  }
  _pdaCache.set(cacheKey, val);
  return val;
}

export function deriveBondingCurve(mint) {
  return cachedPDA('bc:' + mint.toBase58(), [SEED_BC, mint.toBuffer()], PUMP_PROGRAM);
}

export function deriveBondingCurveV2(mint) {
  return cachedPDA('bcv2:' + mint.toBase58(), [SEED_BC_V2, mint.toBuffer()], PUMP_PROGRAM);
}

export function deriveCreatorVault(creator) {
  return cachedPDA('cv:' + creator.toBase58(), [SEED_CV, creator.toBuffer()], PUMP_PROGRAM);
}

export function deriveEventAuthority(programId = PUMP_PROGRAM) {
  if (programId === PUMP_PROGRAM || programId.equals(PUMP_PROGRAM)) return EVENT_AUTH_PUMP;
  if (programId === PUMP_AMM || programId.equals(PUMP_AMM)) return EVENT_AUTH_AMM;
  return findPDA([SEED_EA], programId);
}

export function deriveGlobalVolumeAccumulator(programId = PUMP_AMM) {
  if (programId === PUMP_AMM || programId.equals(PUMP_AMM)) return GVA_AMM;
  if (programId === PUMP_PROGRAM || programId.equals(PUMP_PROGRAM)) return GVA_PUMP;
  return findPDA([SEED_GVA], programId);
}

export function deriveUserVolumeAccumulator(user, programId = PUMP_AMM) {
  const key = 'uva:' + user.toBase58() + ':' + programId.toBase58();
  return cachedPDA(key, [SEED_UVA, user.toBuffer()], programId);
}

export function deriveBcFeeConfig() {
  return BC_FEE_CONFIG;
}

export function deriveAmmFeeConfig() {
  return AMM_FEE_CONFIG;
}

export function derivePoolAuthority(baseMint) {
  return cachedPDA('pa:' + baseMint.toBase58(), [SEED_PA, baseMint.toBuffer()], PUMP_PROGRAM);
}

export function derivePoolV2(baseMint) {
  return cachedPDA('pv2:' + baseMint.toBase58(), [SEED_PV2, baseMint.toBuffer()], PUMP_AMM);
}

export function deriveAmmCreatorVault(coinCreator) {
  return cachedPDA('acv:' + coinCreator.toBase58(), [SEED_AMM_CV, coinCreator.toBuffer()], PUMP_AMM);
}

export function derivePool(poolAuthority, baseMint, quoteMint) {
  const key = 'pool:' + baseMint.toBase58();
  return cachedPDA(key, [
    SEED_POOL, POOL_INDEX_BUF,
    poolAuthority.toBuffer(), baseMint.toBuffer(), quoteMint.toBuffer(),
  ], PUMP_AMM);
}

export function deriveATA(owner, mint, tokenProgram) {
  const key = 'ata:' + owner.toBase58() + ':' + mint.toBase58() + ':' + tokenProgram.toBase58();
  return cachedPDA(key, [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM);
}
