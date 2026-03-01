# Freedom Trader

BSC MEME 代币交易终端 — Chrome 侧边栏扩展。

通过 FreedomRouter 统一路由，自动判断 Four.meme 内盘 / PancakeSwap 外盘，一键买卖。

## 功能

- **统一路由** — 输入代币地址，自动检测内盘/外盘，一键交易
- **多钱包批量交易** — 批量添加私钥，选中多个钱包并发交易
- **自动识别** — 浏览 debot.ai / gmgn.ai / dexscreener / bscscan 等时自动提取合约地址
- **密码保护** — PBKDF2 派生密钥 + AES-GCM-256 加密私钥，密钥不存储
- **自动锁定** — 可配置 5 分钟 ~ 永不锁定，超时自动锁定需重新输入密码
- **交易计时** — 实时显示发送耗时、确认耗时，便于测算交易速度
- **完全免费** — 小费 0-1% 自愿设置，默认 0

## 安装（小白推荐）

无需安装 Node.js，直接下载编译好的扩展：

1. 打开 [GitHub Actions](../../actions/workflows/build-extension.yml) 页面
2. 点击最新一次成功的运行记录
3. 在页面底部 **Artifacts** 区域下载 `freedom-trader-xxx` 压缩包
4. 解压得到 `dist/` 文件夹
5. Chrome 打开 `chrome://extensions/`，启用「开发者模式」
6. 点击「加载已解压的扩展程序」→ 选择解压出的文件夹

## 安装（开发者）

```bash
cd trader-extension
npm install
npm run build
```

1. Chrome 打开 `chrome://extensions/`
2. 启用「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `dist/` 目录

## 首次使用

1. 点击扩展图标，侧边栏会提示设置密码
2. 进入设置页，设置加密密码（至少 6 位）
3. 添加 RPC URL（必填）
4. 添加钱包私钥（支持批量：`名称:私钥` 每行一个）
5. 小费设置：0-1%，默认 0（完全免费）

## 使用

1. 打开侧边栏，输入密码解锁
2. 输入/粘贴代币合约地址（或浏览 debot.ai 等网站自动填入）
3. 选择钱包，设置金额、滑点、Gas Price
4. 点击买入/卖出，交易完成后显示耗时

## 安全机制

```
用户密码 → PBKDF2(100000轮, SHA-256) → AES-256-GCM 密钥
                                          ↓
                                    加密/解密私钥
```

- **密钥不存储** — 每次由用户密码 + 随机 salt 实时派生
- **密码验证** — 存储 SHA-256(salt + password) 哈希，用于验证密码正确性
- **自动锁定** — 超过设定时间后清除内存中的派生密钥
- **修改密码** — 用旧密码解密所有钱包，用新密码重新加密

## 交易流程

```
用户 → FreedomRouter (Proxy)
         ├─ 内盘 (Four.meme): TM_V2.buyTokenAMAP / sellToken
         └─ 外盘 (PancakeSwap): swapExactETHForTokens / swapExactTokensForETH
```

- **买入**：发送 BNB，代币直接到用户钱包，自动 approve（方便后续卖出）
- **卖出**：内盘 approve 给 TM_V2，外盘 approve 给 Router Proxy

## 交易性能

实测各阶段耗时（BSC mainnet）：

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 构造交易 | ~3ms | 纯本地计算 |
| 签名交易 | ~5ms | secp256k1 签名 |
| 发送到 RPC | ~140ms | 网络往返 |
| 链上确认 | ~0.5-1.5s | BSC 出块间隔 ~0.45s |

瓶颈在网络和出块时间，与语言无关。使用低延迟 RPC 节点可进一步优化。

## 合约

| 合约 | 地址 |
|------|------|
| FreedomRouter (Proxy) | `0x7A86112117E8E87cF87b15ab1fB5c0B43D97d856` |
| TokenManager V2 | `0x5c952063c7fc8610FFDB798152D69F0B9550762b` |

## 技术栈

- Chrome Extension Manifest V3 (Side Panel)
- viem (链交互)
- esbuild (打包)
- Web Crypto API — PBKDF2 + AES-GCM-256（私钥加密）

## 目录

```
trader-extension/
├── src/
│   ├── crypto.js       # 加密消息代理（转发给 background）
│   ├── trader.js       # 交易逻辑 + 解锁检查 + 交易计时
│   ├── trader.html     # 交易界面 + 解锁遮罩层
│   ├── settings.js     # 设置页 + 密码管理 + 锁定配置
│   └── settings.html   # 设置界面 + 密码/锁定 UI
├── background.js       # Service Worker：密钥缓存 + URL 合约识别
├── manifest.json
├── scripts/
│   ├── build.js        # esbuild 构建
│   └── bench-tx-timing.mjs  # 交易耗时测量工具
└── dist/               # 构建输出，加载到 Chrome
```

## 安全提示

- 私钥由密码派生的 AES-256-GCM 密钥加密，密钥本身不存储
- 忘记密码无法恢复私钥，需重新导入
- 建议使用专用交易钱包，不要使用主钱包
- MEME 代币风险极高，请谨慎操作

## License

MIT
