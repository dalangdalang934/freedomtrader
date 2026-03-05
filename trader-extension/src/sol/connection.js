import { Connection } from '@solana/web3.js';
import { DEFAULT_SOL_RPC } from './constants.js';

let _connection = null;
let _wssUrl = null;

// Blockhash prefetch state
let _latestBlockhash = null;
let _blockhashAge = 0;
let _blockhashTimer = null;
const BLOCKHASH_REFRESH_MS = 2000;
const BLOCKHASH_MAX_AGE_MS = 10000;

function deriveWsEndpoint(httpUrl) {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function createConnection(rpcUrl, wsUrl) {
  const wsEndpoint = wsUrl || deriveWsEndpoint(rpcUrl);
  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint,
  });
}

export function getConnection(rpcUrl) {
  if (!_connection || rpcUrl) {
    _connection = createConnection(rpcUrl || DEFAULT_SOL_RPC, _wssUrl);
  }
  return _connection;
}

export function setConnection(rpcUrl, wsUrl) {
  _wssUrl = wsUrl || null;
  _connection = createConnection(rpcUrl, _wssUrl);
  restartBlockhashPrefetch();
  return _connection;
}

export function getWssUrl() {
  return _wssUrl;
}

// ── Blockhash prefetch ──────────────────────────────────────────────────────

async function refreshBlockhash() {
  try {
    const conn = _connection;
    if (!conn) return;
    const result = await conn.getLatestBlockhash('confirmed');
    _latestBlockhash = result;
    _blockhashAge = Date.now();
  } catch (e) {
    console.warn('[BLOCKHASH] Prefetch failed:', e.message);
  }
}

function restartBlockhashPrefetch() {
  if (_blockhashTimer) clearInterval(_blockhashTimer);
  _latestBlockhash = null;
  _blockhashAge = 0;

  if (!_connection) return;
  refreshBlockhash();
  _blockhashTimer = setInterval(refreshBlockhash, BLOCKHASH_REFRESH_MS);
}

/**
 * Returns a prefetched blockhash if fresh enough, otherwise fetches a new one.
 * When prefetch is active, this returns instantly (0ms) most of the time.
 */
export function getBlockhashFast() {
  const conn = _connection;
  if (!conn) return conn.getLatestBlockhash('confirmed');

  if (_latestBlockhash && (Date.now() - _blockhashAge < BLOCKHASH_MAX_AGE_MS)) {
    return Promise.resolve(_latestBlockhash);
  }
  return conn.getLatestBlockhash('confirmed');
}
