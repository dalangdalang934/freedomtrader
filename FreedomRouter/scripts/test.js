const hre = require("hardhat");
require("dotenv").config();

const ROUTER = process.env.ROUTER_ADDRESS;
const TOKEN  = process.env.TOKEN_ADDRESS || "0x17e915ec75ba049ee32b9aa87d1d119346a24444";
const GAS    = { gasPrice: hre.ethers.parseUnits("0.15", "gwei"), gasLimit: 800000 };

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const cmd = process.env.CMD || "info";
  const tipRate = parseInt(process.env.TIP || "0");
  const [signer] = await hre.ethers.getSigners();
  const router = await hre.ethers.getContractAt("FreedomRouterImpl", ROUTER);
  const token  = new hre.ethers.Contract(TOKEN, ERC20, signer);
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const fmt  = (v) => hre.ethers.formatUnits(v, decimals);
  const fmtE = (v) => hre.ethers.formatEther(v);
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const info = await router.getTokenInfo(TOKEN, signer.address);

  console.log(`Router: ${ROUTER}  Token: ${symbol} (${TOKEN})`);
  console.log(`Account: ${signer.address}`);
  if (tipRate > 0) console.log(`Tip: ${tipRate/100}%`);
  else console.log(`Tip: 0 (free)`);
  console.log();

  if (cmd === "info") {
    const bnb = await hre.ethers.provider.getBalance(signer.address);
    console.log(`BNB: ${fmtE(bnb)}  ${symbol}: ${fmt(info.userBalance)}`);
    console.log(`mode: ${info.mode} (${info.isInternal ? "内盘" : "外盘"})  halt: ${info.tradingHalt}`);
    console.log(`tmVersion: ${info.tmVersion}  tmAddress: ${info.tmAddress}`);
    console.log(`tmQuote: ${info.tmQuote} (${info.tmQuote === hre.ethers.ZeroAddress ? "BNB" : "ERC20"})`);
    console.log(`tmFunds: ${fmtE(info.tmFunds)}  tmMaxFunds: ${fmtE(info.tmMaxFunds)}`);
    console.log(`tmOffers: ${fmt(info.tmOffers)}  tmMaxOffers: ${fmt(info.tmMaxOffers)}`);
    console.log(`tmLiquidityAdded: ${info.tmLiquidityAdded}  tmStatus: ${info.tmStatus}`);
    console.log(`isTaxToken: ${info.isTaxToken}  taxFeeRate: ${info.taxFeeRate}`);
    console.log(`pair: ${info.pair}  quoteToken: ${info.quoteToken}  hasLiquidity: ${info.hasLiquidity}`);

    const tmV2 = await router.tokenManagerV2();
    const helper3 = await router.tmHelper3();
    console.log(`\nallowance → TM_V2: ${fmt(await token.allowance(signer.address, tmV2))}`);
    console.log(`allowance → Proxy: ${fmt(await token.allowance(signer.address, ROUTER))}`);
    console.log(`Helper3: ${helper3}`);
  }

  else if (cmd === "buy") {
    const amount = process.env.AMOUNT || "0.0001";
    console.log(`买入 ${amount} BNB → ${symbol}`);
    const tx = await router.buy(TOKEN, 0, deadline, tipRate, { value: hre.ethers.parseEther(amount), ...GAS });
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    for (const log of r.logs) {
      try { const p = router.interface.parseLog(log); if (p?.name === "Swap") console.log(`获得: ${fmt(p.args.amountOut)} ${symbol}`); } catch {}
    }
  }

  else if (cmd === "sell") {
    const pct = parseInt(process.env.SELL_PCT || "10");
    const bal = await token.balanceOf(signer.address);
    const amount = bal * BigInt(pct) / 100n;
    console.log(`卖出 ${pct}% = ${fmt(amount)} ${symbol}`);

    const approveTarget = _getApproveTarget(info, await router.tokenManagerV2(), await router.tmHelper3(), ROUTER);
    const allowance = await token.allowance(signer.address, approveTarget);
    if (allowance < amount) {
      console.log(`approve → ${approveTarget}...`);
      await (await token.approve(approveTarget, hre.ethers.MaxUint256, GAS)).wait();
    }

    const tx = await router.sell(TOKEN, amount, 0, deadline, tipRate, GAS);
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    for (const log of r.logs) {
      try { const p = router.interface.parseLog(log); if (p?.name === "Swap") console.log(`获得: ${fmtE(p.args.amountOut)} BNB`); } catch {}
    }
  }

  else if (cmd === "test") {
    const buyAmt = process.env.AMOUNT || "0.0001";

    console.log("=== 买入 ===");
    const buyTx = await router.buy(TOKEN, 0, deadline, tipRate, { value: hre.ethers.parseEther(buyAmt), ...GAS });
    console.log("TX:", buyTx.hash);
    const buyR = await buyTx.wait();
    let bought = 0n;
    for (const log of buyR.logs) {
      try { const p = router.interface.parseLog(log); if (p?.name === "Swap") { bought = p.args.amountOut; console.log(`获得: ${fmt(bought)} ${symbol}`); } } catch {}
    }

    if (bought > 0n) {
      const sellAmt = bought / 2n;
      console.log(`\n=== 卖出 50% = ${fmt(sellAmt)} ${symbol} ===`);

      const approveTarget = _getApproveTarget(info, await router.tokenManagerV2(), await router.tmHelper3(), ROUTER);
      const allowance = await token.allowance(signer.address, approveTarget);
      if (allowance < sellAmt) {
        console.log(`approve → ${approveTarget}...`);
        await (await token.approve(approveTarget, hre.ethers.MaxUint256, GAS)).wait();
      }

      try {
        const sellTx = await router.sell(TOKEN, sellAmt, 0, deadline, tipRate, GAS);
        console.log("TX:", sellTx.hash);
        const sellR = await sellTx.wait();
        for (const log of sellR.logs) {
          try { const p = router.interface.parseLog(log); if (p?.name === "Swap") console.log(`获得: ${fmtE(p.args.amountOut)} BNB`); } catch {}
        }
      } catch (e) {
        console.log("卖出失败:", e.shortMessage || e.message.slice(0, 200));
      }
    }

    const bnb = await hre.ethers.provider.getBalance(signer.address);
    const bal = await token.balanceOf(signer.address);
    console.log(`\n最终: BNB=${fmtE(bnb)}  ${symbol}=${fmt(bal)}`);
  }
}

/**
 * 内盘 BNB 计价 → approve 给 TM_V2
 * 内盘 ERC20 计价 → approve 给 Helper3 (sellForEth 需要)
 * 外盘 → approve 给 Router Proxy
 */
function _getApproveTarget(info, tmV2, helper3, routerProxy) {
  if (info.isInternal) {
    const quote = info.tmQuote;
    if (quote === hre.ethers.ZeroAddress) return tmV2;
    return helper3;
  }
  return routerProxy;
}

main().then(() => process.exit(0)).catch(e => { console.error(e.shortMessage || e.message.slice(0, 300)); process.exit(1); });
