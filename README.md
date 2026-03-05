# Freedom Trader

BSC + Solana 双链聚合交易终端 — **0 手续费**，多钱包批量交易，一键买卖，秒级上链。

覆盖 Pump.fun 内盘 / PumpSwap AMM / Four.meme 内盘 / PancakeSwap 外盘，自动识别交易路径，无需手动切换。小费自愿，默认 0。

## ✦ v2.0 更新

- **Solana 链全面支持** — Pump.fun Bonding Curve + PumpSwap AMM 双路径自动识别，买入卖出 **0 手续费**
- **Jito Bundle 加速** — 交易同时发送至 RPC 和 Jito Block Engine，双通道竞速上链
- **Blockhash 预取** — 后台 2 秒刷新，交易构建零等待，链上确认快人一步
- **SOL 多钱包批量交易** — 与 BSC 同级体验，多钱包并行下单，百分比卖出
- **双链一键切换** — BSC / SOL 顶部切换，钱包、余额、LP 信息无缝联动
- **Token-2022 兼容** — 原生支持 Solana Token-2022 标准代币
- **WebSocket 确认** — 支持独立 WSS 端点，交易确认更快更稳
- **暗色主题** — Light / Dark 一键切换，深夜交易不伤眼
- **密码锁** — AES-GCM 加密私钥，自动锁定，安全无忧
- **自定义快捷键** — 快速买卖金额、滑点、一键百分比卖出，自由配置

## 项目结构

| 目录 | 说明 |
|------|------|
| [FreedomRouter/](FreedomRouter/) | BSC 聚合路由合约 — 自动判断 Four.meme 内盘 / PancakeSwap 外盘 |
| [trader-extension/](trader-extension/) | Chrome 侧边栏扩展 — BSC + SOL 双链多钱包批量交易终端 |

## 合约地址（BSC 主网）

| 合约 | 地址 |
|------|------|
| FreedomRouter (Proxy) | [`0x87083948E696c19B1CE756dd6995D4a615a7f2c3`](https://bscscan.com/address/0x87083948E696c19B1CE756dd6995D4a615a7f2c3) |
| TokenManager V1 | [`0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC`](https://bscscan.com/address/0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC) |
| TokenManager V2 | [`0x5c952063c7fc8610FFDB798152D69F0B9550762b`](https://bscscan.com/address/0x5c952063c7fc8610FFDB798152D69F0B9550762b) |
| TokenManagerHelper3 | [`0xF251F83e40a78868FcfA3FA4599Dad6494E46034`](https://bscscan.com/address/0xF251F83e40a78868FcfA3FA4599Dad6494E46034) |

## Solana 交易路径

| 阶段 | 协议 | 说明 |
|------|------|------|
| 未毕业 | Pump.fun Bonding Curve | 内盘直接买卖，自动创建 ATA |
| 已毕业 | PumpSwap AMM | 外盘流动池交易，SOL ↔ WSOL 自动封装 |

自动识别代币阶段，无需手动选择路径。支持 SPL Token 和 Token-2022 双标准。

## RPC 建议

交易速度与 RPC 延迟直接相关。**强烈建议使用专用 RPC**，公共 RPC 速率有限且不稳定。

### BSC

**建议使用隐私防夹 RPC**。公共 RPC 的交易进入公开 mempool，容易被 MEV 夹子攻击（sandwich attack）。

| RPC | URL | 说明 |
|-----|-----|------|
| 48 Club | `https://rpc.48.club` | 隐私防夹，交易不进公开 mempool |
| Debot x BlockRazor | `https://debot.bsc.blockrazor.xyz` | 隐私防夹 |
| BSC 官方 | `https://bsc-dataseed.binance.org` | 公共 RPC，无隐私保护 |

### Solana

推荐 [GetBlock](https://getblock.io) — 注册即送免费额度，连接钱包还有额外赠送。

> **性能提示：** 同时配置 HTTP + WSS 两个端点，交易构建走 HTTP，确认监听走 WSS，双通道并行，上链更快。

| 类型 | 说明 |
|------|------|
| HTTP | 用于发送交易和查询状态，填入插件「SOL RPC」 |
| WSS | 用于 WebSocket 订阅确认，填入插件「SOL WSS」（可选但推荐） |

公共 RPC 备用：

| RPC | URL |
|-----|-----|
| PublicNode | `https://solana-rpc.publicnode.com` |
| Solana 官方 | `https://api.mainnet-beta.solana.com` |

## 小费

完全自愿，`tipRate` 参数控制（默认 0 = 完全免费）：

| tipRate | 比例 |
|---------|------|
| `0` | 0%（免费） |
| `10` | 0.1% |
| `100` | 1% |
| `500` | 5%（上限） |

BSC 接收地址：[`0x2De78dd769679119b4B3a158235678df92E98319`](https://bscscan.com/address/0x2De78dd769679119b4B3a158235678df92E98319)（合约中硬编码，不可修改）

SOL 接收地址：[`D6kPpTmJQA3eCLAZVJj8c3JKsrmHzm9q9sTQu6BvzPxP`](https://solscan.io/account/D6kPpTmJQA3eCLAZVJj8c3JKsrmHzm9q9sTQu6BvzPxP)

## 支持的平台自动识别

浏览以下平台时，插件自动提取合约地址并识别所属链：

| 平台 | BSC | SOL |
|------|:---:|:---:|
| [GMGN](https://gmgn.ai) | ✓ | ✓ |
| [DexScreener](https://dexscreener.com) | ✓ | ✓ |
| [Birdeye](https://birdeye.so) | ✓ | ✓ |
| [Photon](https://photon-sol.tinyastro.io) | ✓ | ✓ |
| [Pump.fun](https://pump.fun) | — | ✓ |
| [Debot](https://debot.io) | ✓ | — |
| [PancakeSwap](https://pancakeswap.finance) | ✓ | — |
| [DexTools](https://www.dextools.io) | ✓ | — |
| [PooCoin](https://poocoin.app) | ✓ | — |
| [BscScan](https://bscscan.com) | ✓ | — |
| [Solscan](https://solscan.io) | — | ✓ |

## 快速开始

### 下载插件（无需开发环境）

1. 打开 [GitHub Actions](../../actions/workflows/build-extension.yml) 页面
2. 点击最新一次成功的构建
3. 下载 Artifacts 中的压缩包，解压后加载到 Chrome

### 本地构建

```bash
cd trader-extension && npm install && npm run build
```

构建产物在 `trader-extension/dist/`，在 Chrome 中加载该目录即可。

### 编译合约（仅 BSC 开发需要）

```bash
cd FreedomRouter && npm install && npx hardhat compile
```

## 技术架构

```
trader.js (入口)
├── state.js          — 全局状态（双链钱包、配置、代币信息）
├── lock.js           — 密码锁（AES-GCM 加密私钥）
├── wallet.js         — 钱包路由
│   ├── wallet-bsc.js — BSC 钱包（viem）
│   └── wallet-sol.js — SOL 钱包（@solana/web3.js）
├── token.js          — 代币检测路由
│   ├── token-bsc.js  — BSC 代币（Four.meme / PancakeSwap）
│   └── token-sol.js  — SOL 代币（Pump.fun / PumpSwap）
├── trading.js        — BSC 交易（FreedomRouter 合约）
├── sol-trading.js    — SOL 交易封装
│   └── sol/          — Solana 核心模块
│       ├── trading.js       — 买卖 + Jito 双发
│       ├── bonding-curve.js — BC 报价与指令
│       ├── pump-swap.js     — AMM 交易指令
│       ├── connection.js    — RPC 连接 + Blockhash 预取
│       ├── accounts.js      — 链上账户解析
│       └── pda.js           — PDA 派生
├── batch.js          — 多钱包批量交易
├── ui.js             — UI 逻辑与链切换
└── theme.js          — 暗色主题
```

## License

[MIT](LICENSE)
