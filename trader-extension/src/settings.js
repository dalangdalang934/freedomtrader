// 设置页面 - 多钱包管理 + 密码安全
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  encryptPrivateKey, isEncrypted,
  setPassword, unlock, lock, isUnlocked, hasPassword,
  getLockDuration, setLockDuration, resetAll
} from './crypto.js';

const $ = id => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let wallets = [];
let solWallets = [];
let unlocked = false;

// 加载配置
async function loadConfig() {
  await initPasswordUI();

  const config = await chrome.storage.local.get([
    'wallets', 'rpcUrl', 'activeWalletIds', 'tipRate',
    'solWallets', 'solRpcUrl', 'solWssUrl', 'solActiveWalletIds',
  ]);

  wallets = config.wallets || [];
  solWallets = config.solWallets || [];
  const activeIds = config.activeWalletIds || [];
  const solActiveIds = config.solActiveWalletIds || [];

  $('rpcUrl').value = config.rpcUrl ?? '';
  $('solRpcUrl').value = config.solRpcUrl ?? '';
  $('solWssUrl').value = config.solWssUrl ?? '';
  $('tipRate').value = config.tipRate != null && config.tipRate !== '' ? config.tipRate : '';

  renderWalletList(activeIds);
  renderSolWalletList(solActiveIds);
}

// ==================== 密码 & 锁定管理 ====================

async function initPasswordUI() {
  const hasPw = await hasPassword();
  const isUnl = await isUnlocked();

  $('pwSetup').style.display = 'none';
  $('pwUnlock').style.display = 'none';
  $('pwManage').style.display = 'none';

  if (!hasPw) {
    $('pwSetup').style.display = 'block';
    unlocked = false;
    setWalletSectionEnabled(false);
  } else if (isUnl) {
    $('pwManage').style.display = 'block';
    unlocked = true;
    setWalletSectionEnabled(true);
    const dur = await getLockDuration();
    $('lockDuration').value = dur.toString();
  } else {
    $('pwUnlock').style.display = 'block';
    unlocked = false;
    setWalletSectionEnabled(false);
  }
}

function setWalletSectionEnabled(enabled) {
  const addPanel = $('addPanel');
  const batchPanel = $('batchPanel');
  if (addPanel) addPanel.style.opacity = enabled ? '1' : '0.4';
  if (addPanel) addPanel.style.pointerEvents = enabled ? 'auto' : 'none';
  if (batchPanel) batchPanel.style.pointerEvents = enabled ? 'auto' : 'none';
}

async function handleSetPassword() {
  const pw = $('newPw').value;
  const confirm = $('confirmPw').value;
  if (!pw || pw.length < 6) { showToast('密码至少6位', 'error'); return; }
  if (pw !== confirm) { showToast('两次密码不一致', 'error'); return; }
  await setPassword(pw);
  unlocked = true;
  showToast('密码已设置', 'success');
  await initPasswordUI();
}

async function handleUnlock() {
  const pw = $('unlockPw').value;
  if (!pw) { showToast('请输入密码', 'error'); return; }
  const ok = await unlock(pw);
  if (!ok) { showToast('密码错误', 'error'); return; }
  unlocked = true;
  showToast('已解锁', 'success');
  await initPasswordUI();
}

async function handleLock() {
  await lock();
  unlocked = false;
  showToast('已锁定', 'success');
  await initPasswordUI();
}

async function handleSaveLockDuration() {
  const dur = parseInt($('lockDuration').value, 10);
  await setLockDuration(dur);
  showToast('锁定时间已保存', 'success');
}

async function handleResetAll() {
  if (!confirm('⚠️ 确定要抹除所有数据吗？\n\n这将删除所有钱包、密码、RPC 配置等全部数据，无法恢复！\n\n请确保已备份好所有私钥。')) return;
  if (!confirm('再次确认：所有数据将被永久删除，包括加密的私钥。是否继续？')) return;
  await resetAll();
  wallets = [];
  solWallets = [];
  unlocked = false;
  showToast('所有数据已清除', 'success');
  await loadConfig();
}

// 渲染钱包列表
function renderWalletList(activeIds = []) {
  const list = $('walletList');

  if (wallets.length === 0) {
    list.innerHTML = '<div style="color:#666;text-align:center;padding:20px;">暂无钱包，请添加</div>';
    return;
  }

  list.innerHTML = wallets.map(w => `
    <div class="wallet-item" data-id="${w.id}">
      <div class="wallet-info">
        <input type="checkbox" class="wallet-checkbox" data-id="${w.id}"
          ${activeIds.includes(w.id) ? 'checked' : ''}>
        <div class="wallet-details">
          <div class="wallet-name">${escapeHtml(w.name)}</div>
          <div class="wallet-address">${escapeHtml(w.address)}</div>
        </div>
      </div>
      <div class="wallet-actions">
        <button class="btn-icon btn-edit" data-id="${w.id}" title="编辑">✏️</button>
        <button class="btn-icon btn-delete" data-id="${w.id}" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');

  // 绑定事件
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = () => deleteWallet(btn.dataset.id);
  });
  list.querySelectorAll('.btn-edit').forEach(btn => {
    btn.onclick = () => editWallet(btn.dataset.id);
  });
  list.querySelectorAll('.wallet-checkbox').forEach(cb => {
    cb.onchange = () => saveActiveWallets();
  });
}

// 添加单个钱包
async function addWallet() {
  if (!unlocked || !(await isUnlocked())) {
    unlocked = false;
    await initPasswordUI();
    showToast('已锁定，请先解锁', 'error');
    return;
  }
  const name = $('walletName').value.trim() || `钱包 ${wallets.length + 1}`;
  let privateKey = $('privateKey').value.trim();

  if (!privateKey) {
    showToast('请输入私钥', 'error');
    return;
  }

  try {
    let key = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
    if (key.length !== 66) throw new Error('长度错误');
    const account = privateKeyToAccount(key);

    // 检查是否已存在
    if (wallets.some(w => w.address.toLowerCase() === account.address.toLowerCase())) {
      showToast('该钱包已存在', 'error');
      return;
    }

    const encrypted = await encryptPrivateKey(key);
    const wallet = {
      id: Date.now().toString(),
      name,
      address: account.address,
      encryptedKey: encrypted
    };

    wallets.push(wallet);
    await chrome.storage.local.set({ wallets });

    $('privateKey').value = '';
    $('walletName').value = '';
    $('addressPreview').textContent = '';

    renderWalletList();
    showToast('钱包已添加', 'success');
  } catch (e) {
    if ((e?.message || '').includes('未解锁')) {
      unlocked = false;
      await initPasswordUI();
      showToast('已锁定，请先解锁', 'error');
      return;
    }
    showToast('私钥格式错误', 'error');
  }
}

// 批量添加钱包
async function batchAddWallets() {
  if (!unlocked || !(await isUnlocked())) {
    unlocked = false;
    await initPasswordUI();
    showToast('已锁定，请先解锁', 'error');
    return;
  }
  const text = $('batchKeys').value.trim();
  if (!text) {
    showToast('请输入私钥', 'error');
    return;
  }

  // 按行分割，支持逗号或换行分隔
  const lines = text.split(/[\n,]/).map(l => l.trim()).filter(l => l);

  let added = 0, failed = 0;

  for (const line of lines) {
    // 格式: 私钥 或 名称:私钥
    const parts = line.split(':');
    const privateKey = parts.length > 1 ? parts[1].trim() : parts[0];
    const name = parts.length > 1 ? parts[0].trim() : null;

    try {
      let key = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
      if (key.length !== 66) throw new Error();

      const account = privateKeyToAccount(key);

      // 检查是否已存在
      if (wallets.some(w => w.address.toLowerCase() === account.address.toLowerCase())) {
        failed++;
        continue;
      }

      const encrypted = await encryptPrivateKey(key);
      wallets.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        name: name || `钱包 ${wallets.length + 1}`,
        address: account.address,
        encryptedKey: encrypted
      });
      added++;
    } catch (e) {
      if ((e?.message || '').includes('未解锁')) {
        unlocked = false;
        await initPasswordUI();
        showToast('已锁定，请先解锁', 'error');
        return;
      }
      failed++;
    }
  }

  await chrome.storage.local.set({ wallets });
  $('batchKeys').value = '';
  toggleBatchAdd(false);
  renderWalletList();
  showToast(`添加 ${added} 个，失败 ${failed} 个`, added > 0 ? 'success' : 'error');
}

// 编辑钱包
async function editWallet(id) {
  const wallet = wallets.find(w => w.id === id);
  if (!wallet) return;

  const newName = prompt('钱包名称:', wallet.name);
  if (newName === null) return;

  wallet.name = newName.trim() || wallet.name;
  await chrome.storage.local.set({ wallets });
  renderWalletList();
  showToast('已更新', 'success');
}

// 删除钱包
async function deleteWallet(id) {
  if (!confirm('确定删除该钱包？')) return;

  wallets = wallets.filter(w => w.id !== id);
  await chrome.storage.local.set({ wallets });
  renderWalletList();
  showToast('已删除', 'success');
}

// 删除所有钱包
async function clearAllWallets() {
  if (!confirm('确定删除所有钱包？此操作不可恢复！')) return;

  wallets = [];
  await chrome.storage.local.set({ wallets, activeWalletIds: [] });
  renderWalletList();
  showToast('已清空', 'success');
}

// 全选/取消全选
function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.wallet-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);

  checkboxes.forEach(cb => cb.checked = !allChecked);
  saveActiveWallets();
}

// 保存选中的钱包
async function saveActiveWallets() {
  const activeIds = Array.from(document.querySelectorAll('.wallet-checkbox:checked'))
    .map(cb => cb.dataset.id);
  await chrome.storage.local.set({ activeWalletIds: activeIds });
}

// 切换批量添加面板
function toggleBatchAdd(show) {
  $('batchPanel').style.display = show ? 'block' : 'none';
  $('addPanel').style.display = show ? 'none' : 'block';
}

// 更新地址预览
function updateAddressPreview(privateKey) {
  const el = $('addressPreview');
  try {
    let key = privateKey.trim();
    if (!key) { el.textContent = ''; return; }
    key = key.startsWith('0x') ? key : '0x' + key;
    if (key.length === 66) {
      const acc = privateKeyToAccount(key);
      el.innerHTML = '✓ ' + acc.address;
      el.style.color = '#00d4aa';
    } else {
      el.textContent = '私钥格式错误';
      el.style.color = '#ff6b6b';
    }
  } catch {
    el.textContent = '私钥格式错误';
    el.style.color = '#ff6b6b';
  }
}

// 保存RPC
async function saveRpc() {
  const rpcUrl = $('rpcUrl').value.trim();
  if (rpcUrl && !/^https?:\/\/.+/.test(rpcUrl)) {
    showToast('RPC URL 格式错误，需以 http:// 或 https:// 开头', 'error');
    return;
  }
  await chrome.storage.local.set({ rpcUrl });
  showToast('RPC已保存', 'success');
}

async function saveSolRpc() {
  const solRpcUrl = $('solRpcUrl').value.trim();
  const solWssUrl = $('solWssUrl').value.trim();
  if (solRpcUrl && !/^https?:\/\/.+/.test(solRpcUrl)) {
    showToast('SOL RPC URL 格式错误，需以 http:// 或 https:// 开头', 'error');
    return;
  }
  if (solWssUrl && !/^wss?:\/\/.+/.test(solWssUrl)) {
    showToast('WSS URL 格式错误，需以 wss:// 开头', 'error');
    return;
  }
  await chrome.storage.local.set({ solRpcUrl, solWssUrl });
  chrome.runtime.sendMessage({
    type: 'SOL_RPC_UPDATED',
    rpcUrl: solRpcUrl,
    wssUrl: solWssUrl,
  }).catch(() => {});
  showToast('SOL RPC 已保存', 'success');
}

// ==================== SOL 钱包管理 ====================

function renderSolWalletList(activeIds = []) {
  const list = $('solWalletList');
  if (solWallets.length === 0) {
    list.innerHTML = '<div style="color:#666;text-align:center;padding:20px;">暂无 SOL 钱包，请添加</div>';
    return;
  }

  list.innerHTML = solWallets.map(w => `
    <div class="wallet-item" data-id="${w.id}">
      <div class="wallet-info">
        <input type="checkbox" class="sol-wallet-checkbox" data-id="${w.id}"
          ${activeIds.includes(w.id) ? 'checked' : ''}>
        <div class="wallet-details">
          <div class="wallet-name">${escapeHtml(w.name)}</div>
          <div class="wallet-address">${escapeHtml(w.address)}</div>
        </div>
      </div>
      <div class="wallet-actions">
        <button class="btn-icon sol-btn-edit" data-id="${w.id}" title="编辑">✏️</button>
        <button class="btn-icon sol-btn-delete" data-id="${w.id}" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.sol-btn-delete').forEach(btn => {
    btn.onclick = () => deleteSolWallet(btn.dataset.id);
  });
  list.querySelectorAll('.sol-btn-edit').forEach(btn => {
    btn.onclick = () => editSolWallet(btn.dataset.id);
  });
  list.querySelectorAll('.sol-wallet-checkbox').forEach(cb => {
    cb.onchange = () => saveSolActiveWallets();
  });
}

function parseSolPrivateKey(keyStr) {
  const decoded = bs58.decode(keyStr);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error(`invalid sol key length: ${decoded.length}`);
}

async function addSolWallet() {
  if (!unlocked || !(await isUnlocked())) {
    unlocked = false;
    await initPasswordUI();
    showToast('已锁定，请先解锁', 'error');
    return;
  }
  const name = $('solWalletName').value.trim() || `SOL 钱包 ${solWallets.length + 1}`;
  const privateKey = $('solPrivateKey').value.trim();

  if (!privateKey) { showToast('请输入私钥', 'error'); return; }

  try {
    const keypair = parseSolPrivateKey(privateKey);
    const address = keypair.publicKey.toBase58();

    if (solWallets.some(w => w.address === address)) {
      showToast('该 SOL 钱包已存在', 'error');
      return;
    }

    const encrypted = await encryptPrivateKey(privateKey);
    solWallets.push({ id: Date.now().toString(), name, address, encryptedKey: encrypted });
    await chrome.storage.local.set({ solWallets });

    $('solPrivateKey').value = '';
    $('solWalletName').value = '';
    $('solAddressPreview').textContent = '';

    renderSolWalletList();
    showToast('SOL 钱包已添加', 'success');
  } catch (e) {
    if ((e?.message || '').includes('未解锁')) {
      unlocked = false;
      await initPasswordUI();
      showToast('已锁定，请先解锁', 'error');
      return;
    }
    showToast('SOL 私钥格式错误（需 base58，且为 32/64 字节）', 'error');
  }
}

async function batchAddSolWallets() {
  if (!unlocked || !(await isUnlocked())) {
    unlocked = false;
    await initPasswordUI();
    showToast('已锁定，请先解锁', 'error');
    return;
  }
  const text = $('solBatchKeys').value.trim();
  if (!text) { showToast('请输入私钥', 'error'); return; }

  const lines = text.split(/[\n,]/).map(l => l.trim()).filter(l => l);
  let added = 0, failed = 0;

  for (const line of lines) {
    const parts = line.split(':');
    const privateKey = parts.length > 1 ? parts[1].trim() : parts[0];
    const name = parts.length > 1 ? parts[0].trim() : null;

    try {
      const keypair = parseSolPrivateKey(privateKey);
      const address = keypair.publicKey.toBase58();

      if (solWallets.some(w => w.address === address)) { failed++; continue; }

      const encrypted = await encryptPrivateKey(privateKey);
      solWallets.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        name: name || `SOL 钱包 ${solWallets.length + 1}`,
        address,
        encryptedKey: encrypted,
      });
      added++;
    } catch (e) {
      if ((e?.message || '').includes('未解锁')) {
        unlocked = false;
        await initPasswordUI();
        showToast('已锁定，请先解锁', 'error');
        return;
      }
      failed++;
    }
  }

  await chrome.storage.local.set({ solWallets });
  $('solBatchKeys').value = '';
  toggleSolBatchAdd(false);
  renderSolWalletList();
  showToast(`添加 ${added} 个，失败 ${failed} 个`, added > 0 ? 'success' : 'error');
}

async function editSolWallet(id) {
  const wallet = solWallets.find(w => w.id === id);
  if (!wallet) return;
  const newName = prompt('钱包名称:', wallet.name);
  if (newName === null) return;
  wallet.name = newName.trim() || wallet.name;
  await chrome.storage.local.set({ solWallets });
  renderSolWalletList();
  showToast('已更新', 'success');
}

async function deleteSolWallet(id) {
  if (!confirm('确定删除该 SOL 钱包？')) return;
  solWallets = solWallets.filter(w => w.id !== id);
  await chrome.storage.local.set({ solWallets });
  renderSolWalletList();
  showToast('已删除', 'success');
}

async function clearAllSolWallets() {
  if (!confirm('确定删除所有 SOL 钱包？此操作不可恢复！')) return;
  solWallets = [];
  await chrome.storage.local.set({ solWallets, solActiveWalletIds: [] });
  renderSolWalletList();
  showToast('已清空', 'success');
}

function toggleSolSelectAll() {
  const checkboxes = document.querySelectorAll('.sol-wallet-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
  saveSolActiveWallets();
}

async function saveSolActiveWallets() {
  const activeIds = Array.from(document.querySelectorAll('.sol-wallet-checkbox:checked'))
    .map(cb => cb.dataset.id);
  await chrome.storage.local.set({ solActiveWalletIds: activeIds });
}

function toggleSolBatchAdd(show) {
  $('solBatchPanel').style.display = show ? 'block' : 'none';
  $('solAddPanel').style.display = show ? 'none' : 'block';
}

function updateSolAddressPreview(privateKey) {
  const el = $('solAddressPreview');
  try {
    const key = privateKey.trim();
    if (!key) { el.textContent = ''; return; }
    const keypair = parseSolPrivateKey(key);
    el.innerHTML = '✓ ' + keypair.publicKey.toBase58();
    el.style.color = '#00d4aa';
  } catch {
    el.textContent = '私钥格式错误 (需 base58)';
    el.style.color = '#ff6b6b';
  }
}

// 保存小费设置
async function saveTip() {
  const raw = $('tipRate').value.trim();
  const tipRate = raw === '' ? 0 : Math.max(0, Math.min(5, parseFloat(raw)));
  await chrome.storage.local.set({ tipRate });
  showToast('小费设置已保存', 'success');
}

// 显示提示
function showToast(msg, type) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// 事件绑定
$('privateKey').addEventListener('input', e => updateAddressPreview(e.target.value));
$('addWalletBtn').addEventListener('click', addWallet);
$('batchAddBtn').addEventListener('click', () => toggleBatchAdd(true));
$('cancelBatchBtn').addEventListener('click', () => toggleBatchAdd(false));
$('confirmBatchBtn').addEventListener('click', batchAddWallets);
$('selectAllBtn').addEventListener('click', toggleSelectAll);
$('clearAllBtn').addEventListener('click', clearAllWallets);
$('saveRpcBtn').addEventListener('click', saveRpc);
$('saveTipBtn').addEventListener('click', saveTip);

// SOL 事件绑定
$('solPrivateKey').addEventListener('input', e => updateSolAddressPreview(e.target.value));
$('solAddWalletBtn').addEventListener('click', addSolWallet);
$('solBatchAddBtn').addEventListener('click', () => toggleSolBatchAdd(true));
$('solCancelBatchBtn').addEventListener('click', () => toggleSolBatchAdd(false));
$('solConfirmBatchBtn').addEventListener('click', batchAddSolWallets);
$('solSelectAllBtn').addEventListener('click', toggleSolSelectAll);
$('solClearAllBtn').addEventListener('click', clearAllSolWallets);
$('saveSolRpcBtn').addEventListener('click', saveSolRpc);

// 密码 & 锁定
$('setPwBtn').addEventListener('click', handleSetPassword);
$('unlockBtn').addEventListener('click', handleUnlock);
$('lockNowBtn').addEventListener('click', handleLock);
$('saveLockBtn').addEventListener('click', handleSaveLockDuration);
$('resetAllBtn').addEventListener('click', handleResetAll);

// 密码输入框回车快捷键
$('unlockPw').addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
$('confirmPw').addEventListener('keydown', e => { if (e.key === 'Enter') handleSetPassword(); });

loadConfig();
