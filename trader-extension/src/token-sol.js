import { formatUnits } from 'viem';
import { state } from './state.js';
import { $, isValidSolAddress, formatNum } from './utils.js';
import { showStatus } from './ui.js';
import { updateBalanceHint } from './wallet.js';
import { updatePrice } from './ui.js';
import { LAMPORTS_PER_SOL, FALLBACK_SOL_RPCS } from './sol/constants.js';
import { setConnection, getWssUrl } from './sol/connection.js';

function isRpcError(msg) {
  return msg.includes('403') || msg.includes('410') ||
    /fetch failed|ECONNREFUSED|ETIMEDOUT|network|socket|429|too many/i.test(msg);
}

async function detectWithFallback(addr) {
  const { detectToken: solDetect } = await import('./sol/trading.js');
  const { getTokenBalance } = await import('./sol/accounts.js');
  const { getConnection } = await import('./sol/connection.js');

  const userConn = getConnection();

  // Try user's configured RPC first
  try {
    const result = await solDetect(addr);
    return { result, getTokenBalance };
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (!isRpcError(msg)) throw e;
    console.warn('[SOL-DETECT] User RPC failed:', msg);
  }

  const savedWss = getWssUrl();
  let lastErr;
  for (const rpc of FALLBACK_SOL_RPCS) {
    try {
      setConnection(rpc);
      console.log('[SOL-DETECT] Trying fallback RPC:', rpc);
      const result = await solDetect(addr);
      if (userConn) setConnection(userConn.rpcEndpoint, savedWss);
      return { result, getTokenBalance };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      console.warn(`[SOL-DETECT] RPC ${rpc} failed:`, msg);
      if (!isRpcError(msg)) throw e;
    }
  }
  if (userConn) setConnection(userConn.rpcEndpoint, savedWss);
  throw lastErr;
}

export async function detectSolToken(addr) {
  if (!addr || !isValidSolAddress(addr)) {
    clearSolTokenDisplay();
    return;
  }

  showStatus('检测中...', 'pending');

  try {
    const { result, getTokenBalance } = await detectWithFallback(addr);

    if (!result) {
      state.tokenInfo = { decimals: 6, symbol: '???', balance: 0n, address: addr };
      state.lpInfo = { hasLP: false, isInternal: false };
      showStatus('非 Pump.fun 代币', 'error');
      return;
    }

    const decimals = 6;

    state.tokenBalances.clear();
    const activeKeypairs = state.solActiveWalletIds
      .map(id => ({ id, kp: state.solKeypairs.get(id) }))
      .filter(e => e.kp);

    const { getTokenMetadata } = await import('./sol/accounts.js');
    const [tokenBals, meta] = await Promise.all([
      Promise.all(activeKeypairs.map(e =>
        getTokenBalance(e.kp.publicKey, result.mint, result.tokenProgram).catch(() => 0n)
      )),
      getTokenMetadata(result.mint).catch(() => null),
    ]);
    const symbol = meta?.symbol || 'PUMP';
    const tokenName = meta?.name || '';

    let totalBalance = 0n;
    activeKeypairs.forEach((e, i) => {
      state.tokenBalances.set(e.id, tokenBals[i]);
      totalBalance += tokenBals[i];
    });

    const isBondingCurve = result.type === 'bonding-curve';
    const hasPool = result.type === 'bonding-curve' || result.type === 'pumpswap';

    let virtualSOL = 0n, virtualToken = 0n;
    let displaySOL = 0n, displayToken = 0n;
    if (isBondingCurve) {
      virtualSOL = result.virtualSolReserves;
      virtualToken = result.virtualTokenReserves;
      displaySOL = result.realSolReserves;
      displayToken = result.realTokenReserves;
    } else if (result.type === 'pumpswap' && result.pool) {
      try {
        const { getPoolReserves } = await import('./sol/accounts.js');
        const reserves = await getPoolReserves(result.pool);
        virtualSOL = reserves.quoteReserve;
        virtualToken = reserves.baseReserve;
        displaySOL = virtualSOL;
        displayToken = virtualToken;
      } catch (e) {
        console.warn('[SOL-DETECT] Failed to read pool reserves:', e.message);
      }
    }

    state.tokenInfo = { decimals, symbol, name: tokenName, balance: totalBalance, address: addr };
    state.lpInfo = {
      hasLP: hasPool,
      isInternal: isBondingCurve,
      reserveBNB: virtualSOL,
      reserveToken: virtualToken,
      displaySOL,
      displayToken,
      solDetectResult: result,
    };

    $('tokenBalanceDisplay').textContent = parseFloat(formatUnits(totalBalance, decimals)).toFixed(4);

    const badge = $('tokenNameBadge');
    const symbolTag = $('tokenSymbolTag');
    const poolTag = $('tokenPoolTag');
    if (badge && symbolTag) {
      symbolTag.textContent = tokenName ? `${tokenName} (${symbol})` : symbol;
      if (poolTag) {
        if (hasPool) {
          poolTag.textContent = isBondingCurve ? '🔥 内盘' : '💧 外盘';
          poolTag.className = 'tag ' + (isBondingCurve ? 'tag-internal' : 'tag-external');
        } else {
          poolTag.textContent = '⚠️ 无Pool';
          poolTag.className = 'tag tag-internal';
        }
      }
      badge.classList.add('show');
    }

    if (hasPool) {
      showSolLPInfo(result, displaySOL, displayToken, decimals, symbol);
      showStatus(isBondingCurve ? 'Pump 内盘 (Bonding Curve)' : 'PumpSwap 外盘 (AMM)', 'success');
    } else {
      showStatus('未找到Pool', 'error');
    }

    updateBalanceHint();
    updatePrice();
  } catch (e) {
    console.error('[SOL-DETECT] Error:', e);
    const msg = String(e?.message || e || '');

    if (msg.includes('403') || msg.includes('429')) {
      showStatus('检测失败：所有 RPC 均被拒绝，请到设置页配置可用 SOL RPC', 'error');
    } else if (/fetch failed|ECONNREFUSED|ETIMEDOUT|network|socket/i.test(msg)) {
      showStatus('检测失败：网络连接失败，请检查网络', 'error');
    } else if (/method not found|method not allowed|unsupported/i.test(msg)) {
      showStatus('检测失败：RPC 不支持所需方法，请更换 RPC', 'error');
    } else {
      showStatus('检测失败: ' + msg, 'error');
    }
  }
}

function showSolLPInfo(result, reserveSOL, reserveToken, decimals, symbol) {
  const div = $('lpInfo');
  if (!div) return;

  const isBondingCurve = result.type === 'bonding-curve';
  const poolType = isBondingCurve ? '🔥 Pump 内盘' : '💧 PumpSwap 外盘';
  const poolColor = isBondingCurve ? 'var(--red)' : 'var(--accent)';

  div.style.display = 'block';
  div.innerHTML = `
    <div class="lp-header">
      <span class="type" style="color:var(--text2);">${poolType}</span>
      <span class="status" style="color:${poolColor};">✓ 已检测</span>
    </div>
    <div class="lp-reserves">
      <div class="lp-res-item">
        <div class="lbl" style="text-transform:uppercase;">SOL 储备</div>
        <div class="val" style="color:var(--yellow);">${(Number(reserveSOL) / LAMPORTS_PER_SOL).toFixed(4)}</div>
      </div>
      <div class="lp-res-item">
        <div class="lbl" title="${symbol}" style="color:#00ffaa;font-weight:700;">${symbol} 储备</div>
        <div class="val" style="color:var(--accent);">${formatNum(reserveToken, decimals)}</div>
      </div>
    </div>
  `;
}

export function clearSolTokenDisplay() {
  state.tokenInfo = { decimals: 6, symbol: '', balance: 0n };
  state.lpInfo = { hasLP: false, isInternal: false };
  $('tokenBalanceDisplay').textContent = '-';
  const badge = $('tokenNameBadge'); if (badge) badge.classList.remove('show');
  const lpDiv = $('lpInfo'); if (lpDiv) lpDiv.style.display = 'none';
  const priceDiv = $('priceInfo'); if (priceDiv) priceDiv.style.display = 'none';
}
