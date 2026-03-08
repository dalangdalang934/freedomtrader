// Message proxy — all crypto & signing ops forwarded to background service worker
// Private keys never leave the background scope.

function send(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

export async function setPassword(password) {
  await send('setPassword', { password });
}

export async function unlock(password) {
  const res = await send('unlock', { password });
  return res.ok;
}

export function lock() {
  return send('lock');
}

export async function isUnlocked() {
  const res = await send('isUnlocked');
  return res.unlocked;
}

export async function hasPassword() {
  const res = await send('hasPassword');
  return res.has;
}

export async function getLockDuration() {
  const res = await send('getLockDuration');
  return res.duration;
}

export async function setLockDuration(minutes) {
  await send('setLockDuration', { minutes });
}

export async function encryptPrivateKey(privateKey, password) {
  const res = await send('encrypt', { plaintext: privateKey, password });
  if (!res.result && res.error) throw new Error(res.error);
  return 'enc:' + res.result;
}

export function isEncrypted(value) {
  if (!value) return false;
  return value.startsWith('enc:');
}

export async function resetAll() {
  await send('resetAll');
}

// Decrypt all wallets in background, return { bsc: {id: addr}, sol: {id: addr} }
export async function initWallets(rpcUrl) {
  return send('initWallets', { rpcUrl });
}

function serializeArg(v) {
  if (typeof v === 'bigint') return { __bigint: v.toString() };
  if (Array.isArray(v)) return v.map(serializeArg);
  return v;
}

// BSC: sign + send writeContract via background. Returns { txHash }.
export async function bscWriteContract(walletId, { address, abi, functionName, args, value, gas, gasPrice }) {
  const payload = {
    walletId, address, abi, functionName,
    args: args.map(serializeArg),
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
  };
  if (value != null) payload.value = value.toString();
  return send('bscWriteContract', payload);
}

// SOL: sign + send a serialized transaction via background. Returns { signature }.
export async function solSignAndSend(walletId, { txBase64, rpcUrl, jitoTipLamports }) {
  return send('solSignAndSend', { walletId, txBase64, rpcUrl, jitoTipLamports });
}
