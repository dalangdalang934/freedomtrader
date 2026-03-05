import { $ } from './utils.js';
import { hasPassword, isUnlocked, unlock } from './crypto.js';

export async function checkAndShowLock() {
  const overlay = $('lockOverlay');
  if (!overlay) return true;

  const hasPw = await hasPassword();
  if (!hasPw) {
    overlay.style.display = 'flex';
    $('lockTitle').textContent = '请先设置密码';
    $('lockDesc').textContent = '前往设置页面创建加密密码';
    $('lockInputArea').style.display = 'none';
    $('lockGoSettings').style.display = 'inline-block';
    return false;
  }

  const isUnl = await isUnlocked();
  if (isUnl) {
    overlay.style.display = 'none';
    return true;
  }

  overlay.style.display = 'flex';
  $('lockTitle').textContent = '请输入密码解锁';
  $('lockDesc').textContent = '密码用于解密钱包私钥';
  $('lockInputArea').style.display = 'block';
  $('lockGoSettings').style.display = 'inline-block';

  return false;
}

export function setupLockEvents(onUnlock) {
  const unlockBtn = $('lockUnlockBtn');
  const pwInput = $('lockPwInput');
  const goSettings = $('lockGoSettings');

  if (unlockBtn) {
    unlockBtn.onclick = async () => {
      const pw = pwInput.value;
      if (!pw) return;
      const ok = await unlock(pw);
      if (ok) {
        $('lockOverlay').style.display = 'none';
        $('lockError').style.display = 'none';
        pwInput.value = '';
        await onUnlock();
      } else {
        $('lockError').textContent = '密码错误';
        $('lockError').style.display = 'block';
      }
    };
  }
  if (pwInput) {
    pwInput.onkeydown = (e) => { if (e.key === 'Enter') unlockBtn?.click(); };
  }
  if (goSettings) {
    goSettings.onclick = () => { location.href = 'settings.html'; };
  }
}
