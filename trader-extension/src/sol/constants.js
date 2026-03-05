import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const PUMP_FEE = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const PUMP_AMM_GLOBAL_CONFIG = new PublicKey('ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const SPL_TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');

export const PUMP_FEE_RECIPIENTS = [
  '62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV',
  '7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ',
  '7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX',
  '9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz',
  'AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY',
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
  'FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz',
  'G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP',
].map(s => new PublicKey(s));

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const DISCRIMINATORS = {
  BUY_EXACT_SOL_IN: Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]),
  BC_SELL:          Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
  AMM_BUY:          Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  AMM_SELL:         Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

export const DEFAULT_SOL_RPC = 'https://solana-rpc.publicnode.com';
export const FALLBACK_SOL_RPCS = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
];
export const DEFAULT_COMPUTE_UNITS = 200_000;
export const DEFAULT_PRIORITY_FEE_LAMPORTS = 100_000;

export const SOL_TIP_RECIPIENT = new PublicKey('D6kPpTmJQA3eCLAZVJj8c3JKsrmHzm9q9sTQu6BvzPxP');
export const DEFAULT_SOL_TIP_BPS = 100;

// Jito tip accounts — randomly pick one per TX for load distribution
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bPHBJkRAt1PSdSHpPxKwBP',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLBVCYmRxDAsGTKiGb',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL91KV',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
].map(s => new PublicKey(s));
export const JITO_BLOCK_ENGINES = [
  'https://mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://singapore.mainnet.block-engine.jito.wtf',
];
export const DEFAULT_JITO_TIP_LAMPORTS = 100_000;
