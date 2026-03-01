// Freedom Trader - Background Service Worker
// 密钥缓存在此，页面切换不丢失

// ==================== 密码 & 加密（核心在 background 保持状态） ====================

const SALT_KEY = 'ft_salt';
const LOCK_DUR_KEY = 'ft_lock_dur';
const PW_HASH_KEY = 'ft_pw_hash';

let cachedKey = null;
let unlockTime = 0;

async function getSalt() {
  const stored = await chrome.storage.local.get([SALT_KEY]);
  if (stored[SALT_KEY]) {
    return Uint8Array.from(atob(stored[SALT_KEY]), c => c.charCodeAt(0));
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [SALT_KEY]: btoa(String.fromCharCode(...salt)) });
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
  const enc = new TextEncoder();
  const salt = await getSalt();
  const data = new Uint8Array([...salt, ...enc.encode(password)]);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function checkExpiry() {
  if (!cachedKey) return false;
  const config = await chrome.storage.local.get([LOCK_DUR_KEY]);
  const dur = (config[LOCK_DUR_KEY] || 30) * 60 * 1000;
  if (Date.now() - unlockTime > dur) {
    cachedKey = null;
    unlockTime = 0;
    return false;
  }
  return true;
}

// ==================== 消息处理 ====================

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
    return { result: btoa(String.fromCharCode(...combined)) };
  },

  async decrypt({ ciphertext }) {
    if (!ciphertext || !cachedKey) return { result: null };
    try {
      const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cachedKey, encrypted);
      return { result: new TextDecoder().decode(decrypted) };
    } catch (e) {
      console.error('解密失败:', e);
      return { result: null };
    }
  },

  async changePassword({ oldPassword, newPassword }) {
    const oldKey = await deriveKey(oldPassword);
    const newKey = await deriveKey(newPassword);

    const stored = await chrome.storage.local.get(['wallets']);
    const wallets = stored.wallets || [];

    for (const w of wallets) {
      if (!w.encryptedKey || w.encryptedKey.length <= 100) continue;
      const combined = Uint8Array.from(atob(w.encryptedKey), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const enc = combined.slice(12);
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, oldKey, enc);
      } catch {
        return { error: '旧密码错误' };
      }

      const newIv = crypto.getRandomValues(new Uint8Array(12));
      const newEnc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: newIv }, newKey, plain);
      const newCombined = new Uint8Array(newIv.length + newEnc.byteLength);
      newCombined.set(newIv);
      newCombined.set(new Uint8Array(newEnc), newIv.length);
      w.encryptedKey = btoa(String.fromCharCode(...newCombined));
    }

    await chrome.storage.local.set({ wallets });
    const hash = await hashPassword(newPassword);
    await chrome.storage.local.set({ [PW_HASH_KEY]: hash });
    cachedKey = newKey;
    unlockTime = Date.now();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTRACT_DETECTED') return;

  const handler = handlers[message.action];
  if (handler) {
    handler(message).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true; // async response
  }
});

// ==================== 侧边栏 & 合约识别 ====================

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const contractAddress = extractContractAddress(tab.url);
    if (contractAddress) {
      chrome.runtime.sendMessage({
        type: 'CONTRACT_DETECTED',
        address: contractAddress,
        source: tab.url
      }).catch(() => {});
    }
  }
});

function extractContractAddress(url) {
  const patterns = [
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

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const addr = match[match.length - 1];
      if (addr && addr.startsWith('0x')) return addr.toLowerCase();
    }
  }
  return null;
}
