import { formatUnits } from 'viem';
import { FREEDOM_ROUTER, ROUTER_ABI, ERC20_ABI, WBNB } from './constants.js';
import { state } from './state.js';
import { $, isValidAddress, formatNum } from './utils.js';
import { showStatus } from './ui.js';
import { updateBalanceHint } from './wallet.js';
import { updatePrice } from './ui.js';

export async function detectBscToken(addr) {
  if (!addr || !isValidAddress(addr)) {
    clearBscTokenDisplay();
    return;
  }

  showStatus('检测中...', 'pending');

  try {
    const firstWallet = state.walletClients.get(state.activeWalletIds[0]);
    const userAddr = firstWallet?.account.address || '0x0000000000000000000000000000000000000000';

    const info = await state.publicClient.readContract({
      address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'getTokenInfo',
      args: [addr, userAddr]
    });

    let totalBalance = 0n;
    state.tokenBalances.clear();
    const tokenEntries = state.activeWalletIds.map(id => ({ id, wc: state.walletClients.get(id) })).filter(e => e.wc);
    const tokenBals = await Promise.all(tokenEntries.map(e =>
      state.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [e.wc.account.address] }).catch(() => 0n)
    ));
    tokenEntries.forEach((e, i) => {
      state.tokenBalances.set(e.id, tokenBals[i]);
      totalBalance += tokenBals[i];
    });

    state.tokenInfo = { decimals: info.decimals, symbol: info.symbol || '???', balance: totalBalance, address: addr };
    $('tokenBalanceDisplay').textContent = parseFloat(formatUnits(totalBalance, info.decimals)).toFixed(4);

    const hasPool = info.isInternal || info.hasLiquidity;
    let rBNB, rToken;
    if (info.isInternal) {
      rBNB = info.tmFunds;
      rToken = info.tmOffers;
    } else {
      const tokenLower = addr.toLowerCase() < WBNB.toLowerCase();
      rBNB = tokenLower ? info.pairReserve1 : info.pairReserve0;
      rToken = tokenLower ? info.pairReserve0 : info.pairReserve1;
    }
    state.lpInfo = {
      hasLP: hasPool,
      isInternal: info.isInternal,
      tmQuote: info.tmQuote,
      reserveBNB: rBNB,
      reserveToken: rToken,
      tmFunds: info.tmFunds,
      tmMaxFunds: info.tmMaxFunds,
      tmOffers: info.tmOffers,
      pair: info.pair,
      isTaxToken: info.isTaxToken,
      taxFeeRate: info.taxFeeRate,
    };

    const badge = $('tokenNameBadge');
    const symbolTag = $('tokenSymbolTag');
    const poolTag = $('tokenPoolTag');
    if (badge && symbolTag) {
      symbolTag.textContent = state.tokenInfo.symbol;
      if (poolTag) {
        if (hasPool) {
          poolTag.textContent = info.isInternal ? '🔥 内盘' : '🥞 外盘';
          poolTag.className = 'tag ' + (info.isInternal ? 'tag-internal' : 'tag-external');
        } else {
          poolTag.textContent = '⚠️ 无LP';
          poolTag.className = 'tag tag-internal';
        }
      }
      badge.classList.add('show');
    }

    if (hasPool) {
      showBscLPInfo(info);
      showStatus(info.isInternal ? 'Four.meme 内盘' : 'PancakeSwap 外盘', 'success');
    } else {
      showStatus('未找到LP', 'error');
    }

    updateBalanceHint();
    updatePrice();
  } catch (e) {
    console.error(e);
    showStatus('检测失败', 'error');
  }
}

function showBscLPInfo(info) {
  const div = $('lpInfo');
  if (!div) return;

  const poolType = info.isInternal ? '🔥 Four 内盘' : '🥞 PCS 外盘';
  const poolColor = info.isInternal ? 'var(--red)' : 'var(--accent)';
  const quoteVal = state.lpInfo.reserveBNB;
  const tokenVal = state.lpInfo.reserveToken;

  div.style.display = 'block';
  div.innerHTML = `
    <div class="lp-header">
      <span class="type" style="color:var(--text2);">${poolType}</span>
      <span class="status" style="color:${poolColor};">✓ 已检测</span>
    </div>
    <div class="lp-reserves">
      <div class="lp-res-item">
        <div class="lbl" style="text-transform:uppercase;">BNB 储备</div>
        <div class="val" style="color:var(--yellow);">${formatNum(quoteVal, 18)}</div>
      </div>
      <div class="lp-res-item">
        <div class="lbl" title="${state.tokenInfo.symbol}" style="color:#00ffaa;font-weight:700;">${state.tokenInfo.symbol} 储备</div>
        <div class="val" style="color:var(--accent);">${formatNum(tokenVal, state.tokenInfo.decimals)}</div>
      </div>
    </div>
  `;
}

export function clearBscTokenDisplay() {
  state.tokenInfo = { decimals: 18, symbol: '', balance: 0n };
  state.lpInfo = { hasLP: false, isInternal: false };
  $('tokenBalanceDisplay').textContent = '-';
  const badge = $('tokenNameBadge'); if (badge) badge.classList.remove('show');
  const lpDiv = $('lpInfo'); if (lpDiv) lpDiv.style.display = 'none';
  const priceDiv = $('priceInfo'); if (priceDiv) priceDiv.style.display = 'none';
}
