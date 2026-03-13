import { Connection } from '@solana/web3.js';
import { DEFAULT_SOL_RPC } from './constants.js';

let _connection = null;
let _wssUrl = null;

// Blockhash prefetch state
let _latestBlockhash = null;
let _blockhashAge = 0;
let _blockhashTimer = null;
let _blockhashRefreshPromise = null;
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
  if (_blockhashRefreshPromise) return _blockhashRefreshPromise;

  _blockhashRefreshPromise = (async () => {
    try {
      const conn = _connection;
      if (!conn) return;
      const result = await conn.getLatestBlockhash('confirmed');
      if (_connection !== conn) return;
      _latestBlockhash = result;
      _blockhashAge = Date.now();
    } catch (e) {
      console.warn('[BLOCKHASH] Prefetch failed:', e.message);
    }
  })();

  try {
    return await _blockhashRefreshPromise;
  } finally {
    _blockhashRefreshPromise = null;
  }
}

function restartBlockhashPrefetch() {
  stopBlockhashPrefetch();
  _latestBlockhash = null;
  _blockhashAge = 0;

  if (!_connection) return;
  refreshBlockhash();
  _blockhashTimer = setInterval(refreshBlockhash, BLOCKHASH_REFRESH_MS);
}

export function stopBlockhashPrefetch() {
  if (_blockhashTimer) clearInterval(_blockhashTimer);
  _blockhashTimer = null;
}

/**
 * Returns a prefetched blockhash if fresh enough, otherwise fetches a new one.
 * When prefetch is active, this returns instantly (0ms) most of the time.
 */
export function getBlockhashFast() {
  const conn = _connection || getConnection();
  if (!conn) return Promise.reject(new Error('SOL connection not initialized'));

  if (_latestBlockhash && (Date.now() - _blockhashAge < BLOCKHASH_MAX_AGE_MS)) {
    return Promise.resolve(_latestBlockhash);
  }
  return conn.getLatestBlockhash('confirmed');
}
