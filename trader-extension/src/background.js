// Freedom Trader - Background Service Worker
// All private keys live here. Frontend never sees plaintext keys.

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { Keypair, Transaction, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const DEFAULT_RPC = 'https://bsc-dataseed.bnbchain.org';
const JITO_BLOCK_ENGINES = [
  'https://mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf',
  'https://slc.mainnet.block-engine.jito.wtf',
];

// ==================== Crypto state ====================

const SALT_KEY = 'ft_salt';
const LOCK_DUR_KEY = 'ft_lock_dur';
const PW_HASH_KEY = 'ft_pw_hash';

let cachedKey = null;
let unlockTime = 0;

// Wallet state — private keys never leave this scope
const bscClients = new Map();   // walletId -> { client, account }
const solKeypairs = new Map();  // walletId -> Keypair
let bscPublicClient = null;
let solConnection = null;

function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getSalt() {
  const stored = await chrome.storage.local.get([SALT_KEY]);
  if (stored[SALT_KEY]) {
    return Uint8Array.from(atob(stored[SALT_KEY]), c => c.charCodeAt(0));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [SALT_KEY]: uint8ToBase64(salt) });
  return salt;
}

async function deriveKey(password) {
  const salt = await getSalt();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function hashPassword(password) {
  const salt = await getSalt();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return uint8ToBase64(new Uint8Array(bits));
}

async function checkExpiry() {
  if (!cachedKey) return false;
  const config = await chrome.storage.local.get([LOCK_DUR_KEY]);
  const dur = (config[LOCK_DUR_KEY] || 30) * 60 * 1000;
  if (Date.now() - unlockTime > dur) {
    cachedKey = null;
    unlockTime = 0;
    bscClients.clear();
    solKeypairs.clear();
    return false;
  }
  return true;
}

async function decryptCiphertext(ciphertext) {
  if (!ciphertext || !cachedKey) return null;
  const raw = ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext;
  try {
    const combined = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cachedKey, encrypted);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Decrypt failed:', e);
    return null;
  }
}

function deserializeArg(v) {
  if (v && typeof v === 'object' && '__bigint' in v) return BigInt(v.__bigint);
  if (Array.isArray(v)) return v.map(deserializeArg);
  return v;
}

// ==================== Wallet initialization ====================

async function buildBscClients(wallets, rpcUrl) {
  bscClients.clear();
  const url = (rpcUrl || '').trim() || DEFAULT_RPC;
  bscPublicClient = createPublicClient({ chain: bsc, transport: http(url) });

  const result = {};
  for (const w of wallets) {
    try {
      const plain = await decryptCiphertext(w.encryptedKey);
      if (!plain) continue;
      let key = plain.startsWith('0x') ? plain : '0x' + plain;
      const account = privateKeyToAccount(key);
      const client = createWalletClient({ chain: bsc, transport: http(url), account });
      bscClients.set(w.id, { client, account });
      result[w.id] = account.address;
    } catch (e) {
      console.error('BSC wallet init failed:', w.id, e);
    }
  }
  return result;
}

async function buildSolKeypairs(wallets) {
  solKeypairs.clear();
  const result = {};
  for (const w of wallets) {
    try {
      const plain = await decryptCiphertext(w.encryptedKey);
      if (!plain) continue;
      const keypair = Keypair.fromSecretKey(bs58.decode(plain));
      solKeypairs.set(w.id, keypair);
      result[w.id] = keypair.publicKey.toBase58();
    } catch (e) {
      console.error('SOL wallet init failed:', w.id, e);
    }
  }
  return result;
}

// ==================== Message handlers ====================

const handlers = {
  async setPassword({ password }) {
    const hash = await hashPassword(password);
    await chrome.storage.local.set({ [PW_HASH_KEY]: hash });
    cachedKey = await deriveKey(password);
    unlockTime = Date.now();
    return { ok: true };
  },

  async unlock({ password }) {
    const stored = await chrome.storage.local.get([PW_HASH_KEY]);
    if (!stored[PW_HASH_KEY]) return { ok: false };
    const hash = await hashPassword(password);
    if (hash !== stored[PW_HASH_KEY]) return { ok: false };
    cachedKey = await deriveKey(password);
    unlockTime = Date.now();
    return { ok: true };
  },

  async lock() {
    cachedKey = null;
    unlockTime = 0;
    bscClients.clear();
    solKeypairs.clear();
    return { ok: true };
  },

  async isUnlocked() {
    return { unlocked: await checkExpiry() };
  },

  async hasPassword() {
    const stored = await chrome.storage.local.get([PW_HASH_KEY]);
    return { has: !!stored[PW_HASH_KEY] };
  },

  async getLockDuration() {
    const config = await chrome.storage.local.get([LOCK_DUR_KEY]);
    return { duration: config[LOCK_DUR_KEY] || 30 };
  },

  async setLockDuration({ minutes }) {
    await chrome.storage.local.set({ [LOCK_DUR_KEY]: minutes });
    return { ok: true };
  },

  async encrypt({ plaintext, password }) {
    let key = cachedKey;
    if (!key && password) key = await deriveKey(password);
    if (!key) return { error: '未解锁' };

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return { result: uint8ToBase64(combined) };
  },

  async resetAll() {
    await chrome.storage.local.clear();
    cachedKey = null;
    unlockTime = 0;
    bscClients.clear();
    solKeypairs.clear();
    return { ok: true };
  },

  // Decrypt all wallets, build signing clients internally, return address maps only
  async initWallets({ rpcUrl }) {
    if (!(await checkExpiry())) return { error: '未解锁' };
    const stored = await chrome.storage.local.get(['wallets', 'solWallets']);
    const bscAddrs = await buildBscClients(stored.wallets || [], rpcUrl);
    const solAddrs = await buildSolKeypairs(stored.solWallets || []);
    return { bsc: bscAddrs, sol: solAddrs };
  },

  // BSC: sign and send a writeContract call
  async bscWriteContract({ walletId, address, abi, functionName, args, value, gas, gasPrice }) {
    if (!(await checkExpiry())) return { error: '已锁定，请重新解锁' };
    let wc = bscClients.get(walletId);
    if (!wc) {
      const cfg = await chrome.storage.local.get(['rpcUrl']);
      await handlers.initWallets({ rpcUrl: cfg.rpcUrl || DEFAULT_RPC });
      wc = bscClients.get(walletId);
    }
    if (!wc) return { error: '钱包未初始化: ' + walletId };

    try {
      const params = {
        address, abi, functionName,
        args: args.map(deserializeArg),
        gas: BigInt(gas), gasPrice: BigInt(gasPrice),
      };
      if (value) params.value = BigInt(value);
      const txHash = await wc.client.writeContract(params);
      return { txHash };
    } catch (e) {
      return { error: e.shortMessage || e.message };
    }
  },

  // SOL: receive serialized unsigned tx, sign with keypair, send via RPC + Jito
  async solSignAndSend({ walletId, txBase64, rpcUrl, jitoTipLamports }) {
    if (!(await checkExpiry())) return { error: '已锁定，请重新解锁' };
    let kp = solKeypairs.get(walletId);
    if (!kp) {
      const cfg = await chrome.storage.local.get(['rpcUrl']);
      await handlers.initWallets({ rpcUrl: cfg.rpcUrl || DEFAULT_RPC });
      kp = solKeypairs.get(walletId);
    }
    if (!kp) return { error: 'SOL 钱包未初始化: ' + walletId };

    try {
      const txBuf = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
      const tx = Transaction.from(txBuf);
      tx.sign(kp);
      const raw = tx.serialize();
      const rawBase64 = uint8ToBase64(raw);

      if (!solConnection || solConnection.rpcEndpoint !== rpcUrl) {
        solConnection = new Connection(rpcUrl, 'confirmed');
      }

      const sends = [solConnection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 2 })];
      if (jitoTipLamports > 0) sends.push(sendToJito(rawBase64));
      const [sig] = await Promise.all(sends);
      return { signature: sig };
    } catch (e) {
      return { error: e.message };
    }
  },

  // Get the BSC address for a wallet (for read-only operations)
  async getWalletAddress({ walletId, chain }) {
    if (chain === 'sol') {
      const kp = solKeypairs.get(walletId);
      return { address: kp ? kp.publicKey.toBase58() : null };
    }
    const wc = bscClients.get(walletId);
    return { address: wc ? wc.account.address : null };
  },
};

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTRACT_DETECTED') return;
  if (sender.id !== chrome.runtime.id) return;

  const handler = handlers[message.action];
  if (handler) {
    handler(message).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

// ==================== Side panel & contract detection ====================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const detected = extractContractAddress(tab.url);
    if (detected) {
      chrome.runtime.sendMessage({
        type: 'CONTRACT_DETECTED',
        address: detected.address,
        chain: detected.chain,
        source: tab.url
      }).catch(() => {});
    }
  }
});

const SOL_ADDR = '[1-9A-HJ-NP-Za-km-z]{32,44}';

function extractContractAddress(url) {
  const solPatterns = [
    new RegExp(`pump\\.fun\\/coin\\/(${SOL_ADDR})`, 'i'),
    new RegExp(`dexscreener\\.com\\/solana\\/(${SOL_ADDR})`, 'i'),
    new RegExp(`birdeye\\.so\\/token\\/(${SOL_ADDR})`, 'i'),
    new RegExp(`gmgn\\.ai\\/sol\\/token\\/(${SOL_ADDR})`, 'i'),
    new RegExp(`solscan\\.io\\/token\\/(${SOL_ADDR})`, 'i'),
    new RegExp(`photons?\\.club\\/[^/]*\\/token\\/(${SOL_ADDR})`, 'i'),
  ];

  for (const pattern of solPatterns) {
    const match = url.match(pattern);
    if (match) return { address: match[1], chain: 'sol' };
  }

  const bscPatterns = [
    /debot\.ai\/(address|token)\/[^/]*\/(?:\d+_)?(0x[a-fA-F0-9]{40})/i,
    /gmgn\.ai\/token\/[^/]*\/(0x[a-fA-F0-9]{40})/i,
    /dexscreener\.com\/[^/]*\/(0x[a-fA-F0-9]{40})/i,
    /dextools\.io.*\/(0x[a-fA-F0-9]{40})/i,
    /poocoin\.app\/tokens\/(0x[a-fA-F0-9]{40})/i,
    /bscscan\.com\/token\/(0x[a-fA-F0-9]{40})/i,
    /bscscan\.com\/address\/(0x[a-fA-F0-9]{40})/i,
    /pancakeswap\.finance.*outputCurrency=(0x[a-fA-F0-9]{40})/i,
    /photons\.club\/token\/[^/]*\/(0x[a-fA-F0-9]{40})/i,
    /birdeye\.so\/token\/(0x[a-fA-F0-9]{40})/i,
    /(0x[a-fA-F0-9]{40})/i
  ];

  for (const pattern of bscPatterns) {
    const match = url.match(pattern);
    if (match) {
      const addr = match[match.length - 1];
      if (addr && addr.startsWith('0x')) return { address: addr.toLowerCase(), chain: 'bsc' };
    }
  }
  return null;
}
