// 设置页面 - 多钱包管理 + 密码安全
import { privateKeyToAccount } from 'viem/accounts';
import {
  encryptPrivateKey, decryptPrivateKey, isEncrypted,
  setPassword, unlock, lock, isUnlocked, hasPassword,
  getLockDuration, setLockDuration, changePassword
} from './crypto.js';

const $ = id => document.getElementById(id);

let wallets = [];
let editingId = null;
let unlocked = false;

// 加载配置
async function loadConfig() {
  await initPasswordUI();

  const config = await chrome.storage.local.get(['wallets', 'rpcUrl', 'activeWalletIds', 'tipRate']);

  wallets = config.wallets || [];
  const activeIds = config.activeWalletIds || [];

  $('rpcUrl').value = config.rpcUrl ?? '';
  $('tipRate').value = config.tipRate != null && config.tipRate !== '' ? config.tipRate : '';

  renderWalletList(activeIds);
}

// ==================== 密码 & 锁定管理 ====================

async function initPasswordUI() {
  const hasPw = await hasPassword();
  const isUnl = await isUnlocked();

  $('pwSetup').style.display = 'none';
  $('pwUnlock').style.display = 'none';
  $('pwManage').style.display = 'none';
  $('pwChange').style.display = 'none';

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
  lock();
  unlocked = false;
  showToast('已锁定', 'success');
  await initPasswordUI();
}

async function handleSaveLockDuration() {
  const dur = parseInt($('lockDuration').value, 10);
  await setLockDuration(dur);
  showToast('锁定时间已保存', 'success');
}

function showChangePwPanel() {
  $('pwManage').style.display = 'none';
  $('pwChange').style.display = 'block';
}

function cancelChangePw() {
  $('pwChange').style.display = 'none';
  $('pwManage').style.display = 'block';
  $('oldPw').value = '';
  $('chNewPw').value = '';
  $('chConfirmPw').value = '';
}

async function handleChangePassword() {
  const oldPw = $('oldPw').value;
  const newPw = $('chNewPw').value;
  const confirmPw = $('chConfirmPw').value;
  if (!oldPw) { showToast('请输入当前密码', 'error'); return; }
  if (!newPw || newPw.length < 6) { showToast('新密码至少6位', 'error'); return; }
  if (newPw !== confirmPw) { showToast('两次密码不一致', 'error'); return; }
  try {
    await changePassword(oldPw, newPw);
    showToast('密码已修改', 'success');
    cancelChangePw();
  } catch (e) {
    showToast('修改失败：' + e.message, 'error');
  }
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
          <div class="wallet-name">${w.name}</div>
          <div class="wallet-address">${w.address}</div>
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
  if (!unlocked) { showToast('请先解锁', 'error'); return; }
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
    showToast('私钥格式错误', 'error');
  }
}

// 批量添加钱包
async function batchAddWallets() {
  if (!unlocked) { showToast('请先解锁', 'error'); return; }
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
    } catch {
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
  await chrome.storage.local.set({ rpcUrl });
  showToast('RPC已保存', 'success');
}

// 保存小费设置
async function saveTip() {
  const raw = $('tipRate').value.trim();
  const tipRate = raw === '' ? 0 : Math.max(0, Math.min(1, parseFloat(raw)));
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

// 密码 & 锁定
$('setPwBtn').addEventListener('click', handleSetPassword);
$('unlockBtn').addEventListener('click', handleUnlock);
$('lockNowBtn').addEventListener('click', handleLock);
$('saveLockBtn').addEventListener('click', handleSaveLockDuration);
$('changePwBtn').addEventListener('click', showChangePwPanel);
$('cancelChangePwBtn').addEventListener('click', cancelChangePw);
$('confirmChangePwBtn').addEventListener('click', handleChangePassword);

// 密码输入框回车快捷键
$('unlockPw').addEventListener('keydown', e => { if (e.key === 'Enter') handleUnlock(); });
$('confirmPw').addEventListener('keydown', e => { if (e.key === 'Enter') handleSetPassword(); });

loadConfig();
