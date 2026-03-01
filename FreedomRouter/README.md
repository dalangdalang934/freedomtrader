# FreedomRouter v4

BSC 聚合路由合约 — 一个入口交易所有 Four.meme MEME 代币。

自动判断 Four.meme 内盘 / PancakeSwap 外盘，精确区分 TM V1/V2 版本，原生支持 BNB 底池和 ERC20 底池（USD1/USDT 等），兼容 TaxToken。完全免费，小费自愿。

## 为什么需要这个

- **Four.meme 内盘**和 **PancakeSwap 外盘**是两套完全不同的交易接口
- 内盘代币分 **BNB 计价** 和 **ERC20 计价**（USD1/USDT），交易方式不同
- Four.meme 有 **V1 和 V2** 两套 TokenManager，接口不同
- FreedomRouter 自动判断、自动路由，用户只需调 `buy` / `sell`

## 架构

```
用户 → Proxy (ERC1967)
         │ delegatecall
         ↓
       Implementation
         ├── Helper3.getTokenInfo(token) → 获取 TM 版本/quote/状态
         │
         ├─ 内盘 (mode != 0 且未上外盘)
         │    ├─ quote == address(0) → BNB 计价
         │    │    ├─ V1: TM_V1.purchaseTokenAMAP / saleToken
         │    │    └─ V2: TM_V2.buyTokenAMAP / sellToken
         │    │
         │    └─ quote == USD1/USDT → ERC20 计价
         │         └─ Helper3.buyWithEth / sellForEth (自动 BNB↔ERC20)
         │
         └─ 外盘 (已上 PancakeSwap)
              └─ findBestQuote() → 选最优底池 → PancakeSwap swap
```

## 合约地址（BSC 主网）

| 合约 | 地址 |
|------|------|
| **FreedomRouter (Proxy)** | `0x87083948E696c19B1CE756dd6995D4a615a7f2c3` |
| TokenManager V1 | `0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC` |
| TokenManager V2 | `0x5c952063c7fc8610FFDB798152D69F0B9550762b` |
| TokenManagerHelper3 | `0xF251F83e40a78868FcfA3FA4599Dad6494E46034` |
| PancakeSwap Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |

## 接口

### buy(token, amountOutMin, deadline, tipRate) payable

BNB 买入代币。自动判断内盘/外盘，内盘自动处理 BNB/ERC20 计价差异。

```javascript
await router.buy(tokenAddress, 0, deadline, 0, { value: parseEther("0.1") });
```

### sell(token, amountIn, amountOutMin, deadline, tipRate)

卖出代币换 BNB。

**Approve 规则：**

| 场景 | approve 目标 |
|------|-------------|
| 内盘 BNB 计价 | TokenManager V2 |
| 内盘 ERC20 计价 | TokenManagerHelper3 |
| 外盘 | Router Proxy |

```javascript
await token.approve(TARGET, MaxUint256);
await router.sell(tokenAddress, amount, 0, deadline, 0);
```

### getTokenInfo(token, user) view

一次调用获取代币完整状态：

```javascript
const info = await router.getTokenInfo(tokenAddress, userAddress);
// info.isInternal      → true=内盘, false=外盘
// info.tmVersion       → 1=V1, 2=V2, 0=非 four 代币
// info.tmQuote         → address(0)=BNB计价, 其他=ERC20计价
// info.tmAddress       → 管理该代币的 TM 地址
// info.isTaxToken      → 是否为 TaxToken
// info.taxFeeRate      → TaxToken 的税率
// info.hasLiquidity    → 外盘是否有流动性
// info.tmLiquidityAdded → 内盘是否已上外盘
```

### getTokenInfoBatch(tokens[], user) view

批量查询多个代币，一次 RPC 调用。

## 小费

完全自愿，`tipRate` 参数控制：

| tipRate | 比例 | 说明 |
|---------|------|------|
| `0` | 0% | 完全免费 |
| `10` | 0.1% | |
| `100` | 1% | |
| `500` | 5% | 上限 |

## 开发

```bash
npm install
npx hardhat compile
```

### 部署

```bash
npx hardhat run scripts/deploy.js --network bsc
```

### 测试

配置 `.env`：

```
PRIVATE_KEY=0x...
ROUTER_ADDRESS=0x87083948E696c19B1CE756dd6995D4a615a7f2c3
TOKEN_ADDRESS=0x...
CMD=test    # info | buy | sell | test
TIP=0       # 0=免费, 10=0.1%
```

```bash
npx hardhat run scripts/test.js --network bsc
```

## v4 变更

- **Helper3 集成**: 通过 `TokenManagerHelper3.getTokenInfo` 精确获取 TM 版本和 quote 类型
- **V1/V2 自动适配**: 自动调用正确版本的 TM 接口
- **ERC20 计价内盘**: USD1/USDT 计价的内盘代币通过 Helper3 的 `buyWithEth` / `sellForEth` 交易
- **TaxToken 支持**: 查询接口返回 `isTaxToken` 和 `taxFeeRate`
- **上外盘检测**: 通过 `liquidityAdded` 判断内盘代币是否已迁移到外盘

## License

MIT
