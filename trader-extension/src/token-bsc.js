import { formatUnits } from 'viem';
import { FREEDOM_ROUTER, ROUTER_ABI, ERC20_ABI, WBNB, ROUTE } from './constants.js';
import { state } from './state.js';
import { $, isValidAddress, formatNum, escapeHtml } from './utils.js';
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
    const userAddr = firstWallet?.address || '0x0000000000000000000000000000000000000000';

    const info = await state.publicClient.readContract({
      address: FREEDOM_ROUTER, abi: ROUTER_ABI, functionName: 'getTokenInfo',
      args: [addr, userAddr]
    });

    let totalBalance = 0n;
    state.tokenBalances.clear();
    const tokenEntries = state.activeWalletIds.map(id => ({ id, wc: state.walletClients.get(id) })).filter(e => e.wc);
    const tokenBals = await Promise.all(tokenEntries.map(e =>
      state.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [e.wc.address] }).catch(() => 0n)
    ));
    tokenEntries.forEach((e, i) => {
      state.tokenBalances.set(e.id, tokenBals[i]);
      totalBalance += tokenBals[i];
    });

    state.tokenInfo = { decimals: info.decimals, symbol: info.symbol || '???', balance: totalBalance, address: addr };
    $('tokenBalanceDisplay').textContent = parseFloat(formatUnits(totalBalance, info.decimals)).toFixed(4);

    const route = Number(info.routeSource);
    const isFour = route >= ROUTE.FOUR_INTERNAL_BNB && route <= ROUTE.FOUR_EXTERNAL;
    const isFlap = route === ROUTE.FLAP_BONDING || route === ROUTE.FLAP_BONDING_SELL || route === ROUTE.FLAP_DEX;
    const hasPool = route !== ROUTE.NONE;

    let rBNB, rToken;
    if (info.isInternal) {
      rBNB = info.tmFunds;
      rToken = info.tmOffers;
    } else if (isFlap) {
      rBNB = info.flapReserve;
      rToken = info.flapCirculatingSupply;
    } else {
      const tokenLower = addr.toLowerCase() < WBNB.toLowerCase();
      rBNB = tokenLower ? info.pairReserve1 : info.pairReserve0;
      rToken = tokenLower ? info.pairReserve0 : info.pairReserve1;
    }

    state.lpInfo = {
      hasLP: hasPool,
      routeSource: route,
      approveTarget: info.approveTarget,
      isInternal: info.isInternal,
      tmQuote: info.tmQuote,
      reserveBNB: rBNB,
      reserveToken: rToken,
      tmFunds: info.tmFunds,
      tmMaxFunds: info.tmMaxFunds,
      tmOffers: info.tmOffers,
      tmTradingFeeRate: info.tmTradingFeeRate,
      pair: info.pair,
      isTaxToken: info.isTaxToken,
      taxFeeRate: info.taxFeeRate,
      // Flap 字段
      flapStatus: info.flapStatus,
      flapReserve: info.flapReserve,
      flapCirculatingSupply: info.flapCirculatingSupply,
      flapPrice: info.flapPrice,
      flapTaxRate: info.flapTaxRate,
      flapProgress: info.flapProgress,
      flapPool: info.flapPool,
    };

    const badge = $('tokenNameBadge');
    const symbolTag = $('tokenSymbolTag');
    const poolTag = $('tokenPoolTag');
    if (badge && symbolTag) {
      symbolTag.textContent = state.tokenInfo.symbol;
      if (poolTag) {
        if (hasPool) {
          if (isFour && info.isInternal) {
            poolTag.textContent = '🔥 Four 内盘';
            poolTag.className = 'tag tag-internal';
          } else if (isFour) {
            poolTag.textContent = '🥞 Four 外盘';
            poolTag.className = 'tag tag-external';
          } else if (route === ROUTE.FLAP_BONDING) {
            poolTag.textContent = '🦋 Flap 内盘';
            poolTag.className = 'tag tag-internal';
          } else if (route === ROUTE.FLAP_BONDING_SELL) {
            poolTag.textContent = '🦋 Flap 内盘(仅卖)';
            poolTag.className = 'tag tag-internal';
          } else if (route === ROUTE.FLAP_DEX) {
            poolTag.textContent = '🦋 Flap DEX';
            poolTag.className = 'tag tag-external';
          } else {
            poolTag.textContent = '🥞 外盘';
            poolTag.className = 'tag tag-external';
          }
        } else {
          poolTag.textContent = '⚠️ 无LP';
          poolTag.className = 'tag tag-internal';
        }
      }
      badge.classList.add('show');
    }

    if (hasPool) {
      showBscLPInfo(info, route);
      const statusText = _routeLabel(route);
      showStatus(statusText, 'success');
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

function _routeLabel(route) {
  switch (route) {
    case ROUTE.FOUR_INTERNAL_BNB: return 'Four.meme 内盘 (BNB)';
    case ROUTE.FOUR_INTERNAL_ERC20: return 'Four.meme 内盘 (ERC20)';
    case ROUTE.FOUR_EXTERNAL: return 'Four.meme 外盘';
    case ROUTE.FLAP_BONDING: return 'Flap 内盘';
    case ROUTE.FLAP_BONDING_SELL: return 'Flap 内盘 (仅卖出)';
    case ROUTE.FLAP_DEX: return 'Flap DEX';
    case ROUTE.PANCAKE_ONLY: return 'PancakeSwap';
    default: return '未知';
  }
}

function showBscLPInfo(info, route) {
  const div = $('lpInfo');
  if (!div) return;

  const isFlap = route === ROUTE.FLAP_BONDING || route === ROUTE.FLAP_BONDING_SELL || route === ROUTE.FLAP_DEX;
  const isFlapBonding = route === ROUTE.FLAP_BONDING || route === ROUTE.FLAP_BONDING_SELL;
  const poolType = isFlap
    ? (isFlapBonding ? '🦋 Flap 内盘' : '🦋 Flap DEX')
    : (info.isInternal ? '🔥 Four 内盘' : '🥞 PCS 外盘');
  const poolColor = info.isInternal || isFlapBonding ? 'var(--red)' : 'var(--accent)';
  const quoteVal = state.lpInfo.reserveBNB;
  const tokenVal = state.lpInfo.reserveToken;
  const quoteLabel = isFlap ? '储备' : 'BNB 储备';
  const quoteDec = isFlap ? 18 : 18;

  let extra = '';
  if (isFlap && info.flapProgress) {
    const pct = (Number(info.flapProgress) / 1e16).toFixed(1);
    extra = `<div class="lp-res-item"><div class="lbl">进度</div><div class="val" style="color:var(--yellow);">${pct}%</div></div>`;
  }
  if (isFlap && info.flapTaxRate > 0n) {
    const taxPct = (Number(info.flapTaxRate) / 100).toFixed(1);
    extra += `<div class="lp-res-item"><div class="lbl">税率</div><div class="val" style="color:var(--red);">${taxPct}%</div></div>`;
  }

  div.style.display = 'block';
  div.innerHTML = `
    <div class="lp-header">
      <span class="type" style="color:var(--text2);">${poolType}</span>
      <span class="status" style="color:${poolColor};">✓ 已检测</span>
    </div>
    <div class="lp-reserves">
      <div class="lp-res-item">
        <div class="lbl" style="text-transform:uppercase;">${quoteLabel}</div>
        <div class="val" style="color:var(--yellow);">${formatNum(quoteVal, quoteDec)}</div>
      </div>
      <div class="lp-res-item">
        <div class="lbl" title="${escapeHtml(state.tokenInfo.symbol)}" style="color:#00ffaa;font-weight:700;">${escapeHtml(state.tokenInfo.symbol)} ${isFlap ? '流通量' : '储备'}</div>
        <div class="val" style="color:var(--accent);">${formatNum(tokenVal, state.tokenInfo.decimals)}</div>
      </div>
      ${extra}
    </div>
  `;
}

export function clearBscTokenDisplay() {
  state.tokenInfo = { decimals: 18, symbol: '', balance: 0n };
  state.lpInfo = { hasLP: false, isInternal: false, routeSource: ROUTE.NONE };
  $('tokenBalanceDisplay').textContent = '-';
  const badge = $('tokenNameBadge'); if (badge) badge.classList.remove('show');
  const lpDiv = $('lpInfo'); if (lpDiv) lpDiv.style.display = 'none';
  const priceDiv = $('priceInfo'); if (priceDiv) priceDiv.style.display = 'none';
}
