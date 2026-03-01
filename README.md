# Freedom Trader

免费 BSC MEME 代币交易工具集 — 聚合路由合约 + Chrome 交易终端。

## 项目结构

| 目录 | 说明 |
|------|------|
| [FreedomRouter/](FreedomRouter/) | BSC 聚合路由合约 — 自动判断 Four.meme 内盘 / PancakeSwap 外盘 |
| [trader-extension/](trader-extension/) | Chrome 侧边栏扩展 — 多钱包批量交易终端 |

## 合约地址（BSC 主网）

| 合约 | 地址 |
|------|------|
| FreedomRouter (Proxy) | [`0x87083948E696c19B1CE756dd6995D4a615a7f2c3`](https://bscscan.com/address/0x87083948E696c19B1CE756dd6995D4a615a7f2c3) |
| TokenManager V1 | [`0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC`](https://bscscan.com/address/0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC) |
| TokenManager V2 | [`0x5c952063c7fc8610FFDB798152D69F0B9550762b`](https://bscscan.com/address/0x5c952063c7fc8610FFDB798152D69F0B9550762b) |
| TokenManagerHelper3 | [`0xF251F83e40a78868FcfA3FA4599Dad6494E46034`](https://bscscan.com/address/0xF251F83e40a78868FcfA3FA4599Dad6494E46034) |

## 快速开始

### 下载插件（无需开发环境）

1. 打开 [GitHub Actions](../../actions/workflows/build-extension.yml) 页面
2. 点击最新一次成功的构建
3. 下载 Artifacts 中的压缩包，解压后加载到 Chrome

### 本地构建

```bash
# 构建插件
cd trader-extension && npm install && npm run build

# 编译合约
cd FreedomRouter && npm install && npx hardhat compile
```

## License

[MIT](LICENSE)
