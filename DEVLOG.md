# Development Log

Chronological record of development sessions, decisions, and changes.

---

## 2026-03-08 — 插件改用 vanity.js 部署的 Proxy

**Scope:** config

**Changes:**
- 使用 `vanity.js` + `DEPLOY_SALT=0x...01f939dad4b2` 一次性部署 Factory/Impl/Proxy，得到 Proxy `0x74518401Ef9072Cb9A513c90C59f430142e27C70`（与当次 run 的预测一致）。
- 插件 `FREEDOM_ROUTER` 更新为该地址；`npm run build` 通过。

**Files touched:**
- `trader-extension/src/constants.js` — FREEDOM_ROUTER → 0x74518401Ef9072Cb9A513c90C59f430142e27C70

---

## 2026-03-08 — FreedomRouter v5 CREATE2 部署 + 插件常量更新

**Scope:** config + deploy

**Changes:**
- 使用 salt `0x...6b2c812ea3` 通过 deploy-vanity.js 在 BSC 主网部署 CREATE2 代理，得到 Proxy: `0x5bCa2Cb3E17A44d7aB060aAD29Eb5a10b4748c86`（Owner/TM_V2/Helper3/Flap Portal 与 vanity-params 一致）。
- 插件 `trader-extension/src/constants.js` 中 `FREEDOM_ROUTER` 更新为该地址；`npm run build` 通过。

**Files touched:**
- `trader-extension/src/constants.js` — FREEDOM_ROUTER → 0x5bCa2Cb3E17A44d7aB060aAD29Eb5a10b4748c86

**Deployment notes:**
- 部署命令：`DEPLOY_SALT=0x...6b2c812ea3 npx hardhat run scripts/deploy-vanity.js --network bsc`
- 构建产物在 `trader-extension/dist/`，Chrome 加载该目录即可。

---

## 2026-03-08 — Fix amount precision + refactor approve + add Flap docs

**Scope:** mixed

**Changes:**
1. **精度修复** — `normalizeIntegerAmount` 原实现会砍掉所有小数（"0.01" → "0"），导致 BNB/SOL 买入直接报零。重写为 `normalizeAmount(input, maxDec=3)`：保留最多 3 位小数，截掉超长尾巴防止 `parseUnits` 精度溢出，同时去前导零和尾零。
2. **approve 逻辑重构** — buy/sell 各自独立的 approve 代码抽成 `ensureApproved()` 统一函数：缓存命中 → 链上查 allowance → 不够再 approve MAX_UINT256 → waitForReceipt 确认。增加 `approvalInFlight` Map 并发去重，避免多钱包同时触发重复 approve。
3. **Flap 文档快照** — 下载 Flap BSC 开发者文档 7 篇（en + zh），含 Portal ABI，存入 `flap/` 目录，用于后续 Flap 链接入参考。

**Files touched:**
- `trader-extension/src/utils.js` — 新增 `normalizeAmount`（替代原 `normalizeIntegerAmount`）
- `trader-extension/src/trading.js` — 抽出 `ensureApproved()`，buy/sell 调用 `normalizeAmount`
- `trader-extension/src/batch.js` — 所有金额入口走 `normalizeAmount`
- `trader-extension/src/ui.js` — 报价/setMax/百分比卖出/快捷按钮/输入框 onChange 走 `normalizeAmount`
- `flap/` — 新增整个目录（en/zh 文档 + assets/ABI + README）

**Decisions & rationale:**
- 默认 maxDec=3 而非 18 → 实测 18 位小数仍会触发 parseUnits 精度问题，3 位足够覆盖正常 BNB/SOL 交易粒度
- approve 用 MAX_UINT256 + waitForReceipt → 一次授权永久生效，等确认后再标记缓存避免竞态

**Known issues / tech debt:**
- Four 路由修复计划已提出但尚未实施（旧路由 `0x8708...f2c3` 不可升级，需新部署）
- Flap 文档为一次性快照，无自动同步

**Next steps:**
- 实施 Four 路由修复：新部署路由合约，修内盘卖出/残差处理/统一保护语义
- 插件侧改为依赖新路由 `detectToken` 返回的交易来源和授权目标

---

## 2026-03-08 — FreedomRouter v5 + Flap 接入 + USD1 卖出 hotfix

**Scope:** feature + bugfix

**Changes:**
1. **Hotfix: USD1 底池卖出 approve 目标错误** — 链上调试 tx `0x2d756a...` 确认：Four 内盘 ERC20 quote 池卖出时，`Helper3.sellForEth` 内部委托 `TM_V2.sellToken` 拉币，所以 `transferFrom` 的发起方是 TM_V2。但插件 `getSellApproveTarget()` 在 `tmQuote != ZERO_ADDR` 时返回 HELPER3，导致用户 approve 给了错误目标。修复：内盘代币统一 approve 给 TM_V2。
2. **FreedomRouter v5 合约** — 全量重写，主要变更：
   - 砍掉 TM V1 所有路径（已无 V1 代币）
   - `_sweepResidue` 改为 `_refundBaseline`：记录交易前 quote/BNB 基线，只退差额
   - `buy()`/`sell()` 入口增加 `require(block.timestamp <= deadline)` 强校验
   - `getTokenInfo` 返回 `routeSource` 和 `approveTarget`，插件不再本地猜
   - 新增 `quoteBuy`/`quoteSell` 统一报价接口
   - 新增 Flap Portal 路径：`_detectRoute` 自动识别 Flap bonding/DEX 状态，`_buyFlap`/`_sellFlap` 通过 Portal `swapExactInput` 交易
   - `RouteSource` 枚举 7 种路径：NONE / FOUR_INTERNAL_BNB / FOUR_INTERNAL_ERC20 / FOUR_EXTERNAL / FLAP_BONDING / FLAP_DEX / PANCAKE_ONLY
3. **插件全面适配 v5** — constants 增加 FLAP_PORTAL/ROUTE 枚举/quoteBuy/quoteSell ABI；trading.js 改用合约返回的 approveTarget + 统一报价；token-bsc.js 保存 routeSource/approveTarget/Flap 字段并展示；ui.js 报价改用 `quoteBuy`/`quoteSell`。

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — v5 全量重写（~610 行）
- `FreedomRouter/scripts/deploy.js` — 更新 v5 部署参数（去 tmV1，加 flapPortal）
- `trader-extension/src/constants.js` — 新增 FLAP_PORTAL、ROUTE 枚举、quoteBuy/quoteSell ABI、TokenInfo 增加 routeSource/approveTarget/Flap 字段
- `trader-extension/src/trading.js` — getSellApproveTarget 优先用合约返回值；报价改走 _getQuoteBuy/_getQuoteSell 统一函数；内盘 gwei 截断用 _isFourInternal()
- `trader-extension/src/token-bsc.js` — 保存 routeSource/approveTarget/Flap 字段；显示 Flap badge/进度/税率
- `trader-extension/src/ui.js` — _updateInternalPrice 改为 _updateRouterPrice，使用 quoteBuy/quoteSell

**Decisions & rationale:**
- 内盘代币不可转账 → 路由只能做"调度器"角色，不能先收币再卖。approve 目标必须是实际做 transferFrom 的合约（TM_V2）
- Flap 代币可转账 → 路由先收币再 approve 给 Portal 卖出
- `_refundBaseline` 替代 `_sweepResidue` → 交易前记录基线，只退增量差额，避免历史 dust 被当前用户拿走
- 保留 v4 回退逻辑 → 新合约部署前插件仍可用旧路由

**Known issues / tech debt:**
- FREEDOM_ROUTER 地址仍为旧 v4（`0x8708...`），需部署 v5 后更新
- Flap 卖出路径假设代币可自由转账，如果 Flap 也有类似 Four 的转账限制需要验证
- `quoteBuy`/`quoteSell` 不是 view 函数（Flap 的 quoteExactInput 不是 view），用 eth_call 模拟即可
- Flap DEX 阶段代币路由暂时也走 Portal，未来可能需要改走 PancakeSwap V3

**Next steps:**
- 部署 FreedomRouter v5 到 BSC 主网
- 更新 FREEDOM_ROUTER 地址到 constants.js
- 链上测试：Four BNB 池买卖 / Four USD1 池买卖 / Flap 买卖
- 验证 Flap 内盘代币转账是否有限制

---

## 2026-03-09 — 审计修复：deadline 保护 + quote 函数防护

**Scope:** security fix

**Changes:**
1. **deadline 保护** — `buy()` 和 `sell()` 新增 `uint256 deadline` 参数，入口处 `require(block.timestamp <= deadline, "Expired")` 强校验，防止交易被矿工无限延迟执行（MEV sandwich）
2. **PancakeSwap deadline 传递** — `_buyPancake` / `_sellPancake` 不再使用无意义的 `block.timestamp + 300`，改为接收并传递外部 deadline
3. **quoteBuy/quoteSell 链上调用防护** — 添加 `require(msg.sender == address(0) || tx.origin == address(0))` 确保只能通过 eth_call 模拟调用，防止链上交易意外触发
4. **插件适配** — ABI 增加 deadline 字段，buy/sell 调用时传入 `当前时间 + 10秒` 作为默认 deadline（BSC 出块 ~0.3s，覆盖约 30+ 个区块）

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — buy/sell 签名加 deadline；_buyPancake/_sellPancake 签名加 dl；quoteBuy/quoteSell 加 eth_call 防护
- `trader-extension/src/constants.js` — ROUTER_ABI buy/sell inputs 加 deadline 字段
- `trader-extension/src/trading.js` — buy()/sell() 调用时计算并传入 deadline

**Decisions & rationale:**
- 默认 10 秒 deadline → BSC 出块 ~0.3s，10 秒约 30+ 个区块，足够正常确认但不会给 MEV 留太大窗口
- `msg.sender == address(0) || tx.origin == address(0)` → eth_call 时 msg.sender 和 tx.origin 通常为零地址，这比 `msg.sender == address(this)` 更通用
- Four 内盘 / Flap 路径无需传 deadline 给底层合约（它们内部不依赖 deadline），入口处的全局校验已足够

**Known issues / tech debt:**
- 合约尚未部署，FREEDOM_ROUTER 地址仍为旧 v4
- DEV 地址硬编码，更换需重新部署实现合约（已知但暂不处理）

**Next steps:**
- 部署 FreedomRouter v5 到 BSC 主网
- 链上测试 deadline 过期场景

---

## 2026-03-09 — 审计修复第二轮：tax token 兼容 + 找零退款 + ABI 精简

**Scope:** security fix + optimization

**Changes:**
1. **Flap tax token 兼容** — `_sellFlap` 改为记录 `safeTransferFrom` 前后余额差，用实际到账数量（`actualIn`）做后续 `forceApprove` 和 `swapExactInput`，防止转账税代币因余额不足 revert
2. **Flap 买入 BNB 找零** — `_buyFlap` 增加 `ethBefore`/`ethRefund` 逻辑，如果 Portal 未消耗全部 BNB（如价格冲击限制），差额退回给用户
3. **PancakeSwap 卖出滑点修正** — `_sellPancake` 传给 PancakeRouter 的 `amountOutMin` 改为 0，避免 tip 扣除前的冗余校验导致 false negative revert；滑点保护统一由外层 `require(amountOut >= amountOutMin)` 完成
4. **ABI 精简** — 删除 `isInternalToken()`（已被 `getTokenInfo.routeSource` 替代）、删除 `getTokenInfoBatch()`（插件未使用）、`findBestQuote()` 从 public 改为 internal（仅内部调用）
5. **插件 ABI 瘦身** — constants.js 中 ROUTER_ABI 删除 `isInternalToken` 条目，`getTokenInfo` tuple 各字段合并为每行 2 字段紧凑格式

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — _sellFlap 实际到账修复；_buyFlap BNB 退款；_sellPancake 去 amountOutMin；删 isInternalToken/getTokenInfoBatch；findBestQuote 改 internal
- `trader-extension/src/constants.js` — ROUTER_ABI 删 isInternalToken，tuple 紧凑化

**Decisions & rationale:**
- `_sellPancake` amountOutMin=0 → PancakeRouter 层面不做滑点校验，由路由外层统一在扣 tip 后校验，避免 tip>0 时 false negative
- 删 `isInternalToken` → `routeSource` 已完全覆盖此信息，减少合约 ABI 暴露面
- `findBestQuote` internal → 外部无需直接调用，减少攻击面

**Known issues / tech debt:**
- 合约尚未部署
- 内盘卖出 `msg.sender.balance` 差值计算仍为架构性限制（Four 代币不可转账）

**Next steps:**
- 部署 FreedomRouter v5 到 BSC 主网
- 链上测试 Flap tax token 卖出
- 链上测试 BNB 找零场景

---

## 2026-03-09 — FreedomRouter 合约审计（只读审查）

**Scope:** audit

**Changes:**
1. 审阅 `FreedomRouter/contracts/FreedomRouter.sol` 与 `VanityDeployer.sol`，重点检查路由判定、授权目标、deadline、退款、tip、Proxy 结构与 Flap/Four/Pancake 三条资金路径
2. 交叉核对 `FreedomRouter/scripts/*.js`、`README.md`、`flap/` 本地文档快照，确认实现与周边脚本/文档是否一致
3. 本地执行 `cd FreedomRouter && npm run compile`，编译通过；未发现自动化测试文件

**Findings:**
1. **高风险功能缺口** — Flap `DEX` 状态代币仍被路由到 `Portal.swapExactInput()`，但本地同步的官方文档写明该接口“当前仅支持 bonding curve 状态交易”，这意味着 `RouteSource.FLAP_DEX` 的买卖路径大概率会直接失败
2. **中风险功能缺口** — Flap 买入路径始终假设可直接用 BNB 作为 `inputToken=address(0)`，但文档明确要求 `nativeToQuoteSwapEnabled=true` 才支持原生币买入；当前 `_detectRoute()` / `_buyFlap()` 未使用该字段做门控
3. **中风险兼容性问题** — Pancake 外盘卖出在用户把代币转入 Router 后，仍使用原始 `amountIn` 做授权和 swap；对 fee-on-transfer / tax token，Router 实际到账会小于 `amountIn`，卖出路径会回滚
4. **架构风险** — 当前 `FreedomRouter` 继承的是 `ERC1967Proxy` 裸代理，仓库内没有 `upgradeTo` / `ProxyAdmin` / UUPS 升级入口；这不是可升级代理，后续修复仍需重新部署新地址
5. **集成风险** — `scripts/test.js` 与 `README.md` 仍保留旧参数顺序/旧 approve 目标说明，容易把链上验证结论带偏

**Files touched:**
- `DEVLOG.md` — 追加本次审计记录

**Decisions & rationale:**
- 审计结论以源码 + 本地同步的 Flap 官方文档快照为准，不依赖记忆
- 将“不可升级 Proxy”记为架构风险而非链上可利用漏洞，因为问题在可维护性/修复流程，不在资产直接被盗

**Known issues / tech debt:**
- `FreedomRouter` 目录下无自动化测试文件，当前只能做静态审阅 + 编译校验
- `dev-docs` skill 本会话不可用，DEVLOG 采用项目现有格式手工追加

**Next steps:**
- ~~修正 Flap 路由：`FLAP_DEX` 不再走 `swapExactInput()`，并在买入前检查 `nativeToQuoteSwapEnabled`~~ → 已在 v6 修复
- ~~修正 `_sellPancake()`：按 Router 实际到账数量卖出，补 tax token 外盘测试~~ → 已在 v6 修复
- 清理 `FreedomRouter/scripts/test.js` 与 `README.md` 的旧签名/旧 approve 说明

---

## 2026-03-09 — FreedomRouter v6：审计修复第三轮

**Scope:** security fix + architecture

**Changes:**
1. **FLAP_DEX 降级到 PancakeSwap** — `_detectRoute()` 不再为 `status==4`（DEX）的 Flap 代币返回 `FLAP_BONDING`/`FLAP_DEX` 路由到 Portal，因为 Portal `swapExactInput` 当前仅支持 bonding curve 状态交易（文档 trade-tokens.md:91）。DEX 状态代币自动 fall through 到 PancakeSwap 兜底。`buy()`/`sell()`/`quoteBuy()`/`quoteSell()` 中 `FLAP_DEX` 也显式归入 PancakeSwap 分支。
2. **nativeToQuoteSwapEnabled 门控** — `_detectRoute()` 中 Flap bonding 代币检测增加条件：仅当 `quoteTokenAddress == address(0)`（原生 BNB 池）或 `nativeToQuoteSwapEnabled == true` 时才返回 `FLAP_BONDING`；ERC20 quote 且 native swap 未开启的代币 fall through 到 PancakeSwap。防止对这类代币用 `inputToken=address(0)` 调 Portal 导致 revert。
3. **Pancake 外盘 tax token 兼容** — `_sellPancake` 重命名为 `_sellPancakeCompat`，transfer 逻辑从 `sell()` 移入函数内部：先记录 `balanceOf(address(this))` 基线，`safeTransferFrom` 后用差值得到 `actualIn`，后续 `forceApprove` 和 PancakeRouter swap 都用 `actualIn` 而非原始 `amountIn`。与 `_sellFlap` 采用相同的 tax token 兼容模式。
4. **UUPS 可升级代理** — `FreedomRouterImpl` 新增继承 `UUPSUpgradeable`，实现 `_authorizeUpgrade(address) internal override onlyOwner`。现在 owner 可通过 `upgradeToAndCall()` 在同一代理地址上热升级实现合约，无需重新部署代理。新增 import `@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol`。
5. **版本升级 v5 → v6** — 合约标题更新为 `FreedomRouterImpl v6`，NatSpec 注释记录 v6 vs v5 变更摘要。

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — 所有上述修改

**Decisions & rationale:**
- FLAP_DEX fall through 而非 revert → 用户不必知道内部路由差异，只要 PancakeSwap 有池就能交易
- nativeToQuoteSwapEnabled 只影响 bonding 阶段买入 → 卖出路径不受影响（sell 不需要 BNB 作为输入），但当前路由统一用 BNB 入口所以 sell 也需要 PancakeSwap 兜底
- `_sellPancakeCompat` 合并 transfer → 函数自包含，不再依赖调用方提前 transferFrom
- UUPS 而非 TransparentProxy → 更轻量，且 OZ v5 已内置，与现有 ERC1967Proxy 兼容

**Known issues / tech debt:**
- 合约尚未部署
- FLAP_DEX 枚举值保留但 `_detectRoute` 不再返回它（保持 ABI 向后兼容）
- 未来 Flap Portal 支持 DEX 状态交易后，可重新启用 Portal 路径（需升级实现合约）

**Next steps:**
- 部署 FreedomRouter v6 到 BSC 主网
- 链上测试：Flap DEX 状态代币 → 确认走 PancakeSwap
- 链上测试：ERC20 quote + nativeSwap disabled 的 Flap 代币 → 确认走 PancakeSwap
- 链上测试：tax token 通过 Pancake 外盘卖出 → 确认不再 revert
- 测试 upgradeToAndCall 热升级流程

---

## 2026-03-09 — FreedomRouter 合约复审（v6）

**Scope:** audit

**Changes:**
1. 复审 `FreedomRouter/contracts/FreedomRouter.sol` 当前 v6，实现重点放在 Flap 路由拆分、Pancake tax token 兼容、UUPS 升级面和回归风险
2. 对照本地 OpenZeppelin `UUPSUpgradeable.sol` 核验升级入口是否真实可用，并重新执行 `cd FreedomRouter && npm run compile`
3. 额外执行 `cd trader-extension && npm run build`，确认插件侧 ABI / 地址改动未导致构建错误

**Findings:**
1. **已修复** — 裸 `ERC1967Proxy` 已升级为 UUPS 路线，`upgradeToAndCall()` + `_authorizeUpgrade(address) onlyOwner` 具备原地热升级能力
2. **已修复** — Pancake 外盘卖出已改为基于 Router 实际到账 `actualIn` 进行授权和 swap，外盘 fee-on-transfer / tax token 兼容性较上版明显改善
3. **仍有中风险逻辑缺口** — `_detectRoute()` 将 `nativeToQuoteSwapEnabled` 同时用于买卖方向判断；但 Flap 文档表明该字段限制的是“原生币买入”，并不等同于“禁止 token 直接卖 BNB”。因此部分“可卖不可买”的 Flap bonding token 仍会被误判为 `No route` 或错误降级到 Pancake
4. **仍有中风险覆盖缺口** — Flap DEX 目前只兜底到 Pancake V2 `Factory.getPair()` / V2 Router；本地文档显示 Flap 迁移既可能走 `V2_MIGRATOR`，也可能走 `V3_MIGRATOR`，并包含 Pancake V3 费率配置。若 DEX 代币迁移到 V3，当前实现仍可能无路由或错价
5. **集成风险仍在** — `FreedomRouter/scripts/test.js` 仍保留旧 `buy/sell` 参数顺序和旧 approve 目标逻辑，不适合继续作为当前版本的链上验证脚本

**Files touched:**
- `DEVLOG.md` — 追加本次复审记录

**Decisions & rationale:**
- 本轮结论从“直接路由错误”收敛到“方向相关能力判断”和“V2/V3 覆盖范围”，说明 v6 修复方向是正确的
- 维持源码 + 本地同步文档作为唯一依据，不依赖外部记忆

**Known issues / tech debt:**
- `quoteBuy` / `quoteSell` 仍未显式纳入 `tipRate` 语义，极小滑点 + 非零 tip 的调用方仍可能自触发 `Slippage`
- 手工验证脚本未同步，降低人工回归测试可信度

**Next steps:**
- 将 Flap 路由能力判断拆成 buy/sell 两套，不要用 `nativeToQuoteSwapEnabled` 阻断卖出
- 为 Flap DEX 增加 Pancake V3 路径，或至少基于 `pool` / `dexId` / `lpFeeProfile` 给出明确“不支持”提示
- 同步修正 `FreedomRouter/scripts/test.js` 与 README 中的旧签名/旧授权说明

---

## 2026-03-09 — FreedomRouter 路由合约审计评价（v6）

**Scope:** audit

**Changes:**
1. 复核 `FreedomRouter/contracts/FreedomRouter.sol` 当前 v6 路由实现，重点检查 Flap/Four/Pancake 三条交易路径、UUPS 升级面、报价函数与授权目标
2. 交叉核对 `FreedomRouter/scripts/test.js`、`FreedomRouter/README.md` 与 `flap/` 本地文档快照，确认实现、测试脚本和文档是否一致
3. 本地执行 `cd FreedomRouter && npm run compile`，编译通过；仓库内未发现独立自动化测试文件

**Findings:**
1. **中风险功能缺口** — Flap DEX 路径在注释和枚举上宣称兼容 Pancake V2/V3，但实现仍只用 V2 `Factory.getPair()` + V2 Router 探测与交易；而本地 Flap 文档明确存在 `V3_MIGRATOR`，且 Portal ABI 也暴露了 `swapExactInputV3`。这意味着迁移到 V3 或其他 DEXId 的 Flap 代币，当前 Router 仍可能直接无路由或报错
2. **中风险集成错误** — `scripts/test.js` 仍按旧签名调用 `buy/sell`（把 `deadline` 和 `tipRate` 顺序传反），并继续沿用“ERC20 内盘 approve 给 Helper3”的旧逻辑；该脚本已经不适合作为 v6 链上验证脚本
3. **低风险文档漂移** — `FreedomRouter/README.md` 仍是 v4 文档，包含旧架构、旧签名、旧 approve 规则和已删除的 V1 说明，容易误导后续接入和人工复测
4. **低风险可维护性问题** — 仓库只有 `scripts/test.js` 形式的手工脚本，没有覆盖 Flap bonding/DEX、Four 内外盘和 UUPS 升级面的自动化测试，后续再改路由时回归风险偏高

**Files touched:**
- `DEVLOG.md` — 追加本次审计记录

**Decisions & rationale:**
- 本轮将“脚本/文档失配”单独列为结论，因为它已经影响当前版本的验证可靠性，不只是说明文字过期
- Flap DEX 兼容性判断以源码实现 + 本地文档快照 + 本地 Portal ABI 为依据，不依赖外部记忆

**Known issues / tech debt:**
- `quoteBuy` / `quoteSell` 仍未把 `tipRate` 纳入接口，调用方若直接拿报价设置 `amountOutMin`，在非零 tip 下仍可能自触发 `Slippage`
- `findBestQuote()` 仍只覆盖有限的 quote token 集合，且仅基于 V2 pair 做流动性选择

**Next steps:**
- 为 Flap DEX 增加 V3/多 DEX 路径，或至少在不支持时明确返回 `No supported DEX route`
- 立即修正 `FreedomRouter/scripts/test.js` 和 `FreedomRouter/README.md`，避免继续用错误脚本做验收
- 补最少量回归测试：Four 内盘 BNB、Four 内盘 ERC20、Flap bonding、Flap DEX(V2/V3)、UUPS upgradeToAndCall

---

## 2026-03-09 — FreedomRouter v6.1：Flap 买卖方向拆分 + DEX 路由改进

**Scope:** bugfix

**Changes:**
1. **新增 `FLAP_BONDING_SELL` 路由** — `RouteSource` 枚举新增 `FLAP_BONDING_SELL`，用于 ERC20 quote + `nativeToQuoteSwapEnabled=false` 的 Flap bonding 代币。卖出走 Portal（`outputToken=address(0)` 不受 nativeSwap 限制，文档 trade-tokens.md:55-58），买入走 PancakeSwap（BNB 买入需要 nativeSwap 支持，文档 trade-tokens.md:51）。
2. **修复 `_detectRoute()` 不再误杀卖出** — bonding + nativeSwap disabled 不再 fall through 到 PancakeSwap，而是返回 `FLAP_BONDING_SELL`。`sell()`/`quoteSell()` 归入 Portal 路径，`buy()`/`quoteBuy()` 归入 PancakeSwap 路径。
3. **FLAP_DEX 显式返回** — `_detectRoute()` 对 `status==4`：先 `findBestQuote()` 找 V2 池，找到返回 `(FLAP_DEX, dexQuote)`；找不到仍返回 `(FLAP_DEX, st.quoteTokenAddress)` 而非 NONE，让 `getTokenInfo` 正确反映 DEX 状态。无 V2 池时 swap 会 revert 并给出明确错误。

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — RouteSource 枚举加 FLAP_BONDING_SELL；_detectRoute 拆分买卖能力 + DEX 显式返回；buy/sell/quoteBuy/quoteSell 适配

**Decisions & rationale:**
- `nativeToQuoteSwapEnabled` 只影响买入方向 → 不能用它阻断卖出，Flap 文档明确说 "sell directly from token to BNB is also supported"
- FLAP_DEX 显式返回而非 fall through → 插件可根据 routeSource 展示正确状态
- V3 暂缓 → BSC 上 Flap 说 "only DEX0 (PancakeSwap)"，V3 需 Quoter 接入，留后续版本

**Known issues / tech debt:**
- Flap DEX 若迁到 V3，V2 路径找不到池，交易会 revert
- FLAP_BONDING_SELL 买入走 PancakeSwap，bonding 阶段通常无 V2 池，买入也会失败

**Next steps:**
- 部署 v6.1 到 BSC 主网
- 链上测试：ERC20 quote + nativeSwap disabled 的 Flap bonding 代币卖出
- 评估 PancakeSwap V3 Quoter 接入

---

## 2026-03-09 — 安全修复：改密码 SOL 钱包遗漏 + DOM XSS 防护

**Scope:** security fix

**Changes:**
1. **改密码逻辑修复** — `background.js` 的 `changePassword` 原实现只遍历 `wallets`（BSC），完全不处理 `solWallets`。改密码后 SOL 钱包密文仍用旧密钥加密，解密时用新密钥 → 解密失败，SOL 钱包私钥丢失。此外，如果 `wallets` 为空数组，循环不会执行，旧密码完全不被验证。修复：在 reEncrypt 之前先用 `hashPassword` 比对哈希验证旧密码；提取 `reEncryptWallets()` 公用函数同时处理 BSC `wallets` 和 SOL `solWallets`。
2. **DOM XSS 防护** — `token-bsc.js` 的 `showBscLPInfo` 和 `token-sol.js` 的 `showSolLPInfo` 中，链上 token symbol（BSC 的 `state.tokenInfo.symbol`、SOL 的 `symbol`）被直接插入 `innerHTML` 模板字符串的 `title` 属性和标签文本中。恶意代币可构造含 HTML/JS 的 symbol，在扩展 origin 内执行任意脚本（扩展后台还暴露了 `decrypt` 接口，解锁态下可直接拿到明文私钥）。修复：所有 symbol 插入 innerHTML 处统一走 `escapeHtml()` 转义。

**Files touched:**
- `trader-extension/background.js` — changePassword 增加哈希验证 + solWallets 重加密
- `trader-extension/src/token-bsc.js` — 导入 escapeHtml，showBscLPInfo innerHTML 中 symbol 转义
- `trader-extension/src/token-sol.js` — 导入 escapeHtml，showSolLPInfo innerHTML 中 symbol 转义

**Decisions & rationale:**
- 旧密码验证用 hashPassword 哈希比对而非尝试解密 → 即使没有任何钱包也能正确拒绝错误密码，且不依赖密文存在
- escapeHtml 用 DOM `textContent → innerHTML` 方式 → 项目已有此实现（utils.js），可靠且无外部依赖
- `textContent` 赋值（如 `symbolTag.textContent`）天然安全，不需要额外转义

**Known issues / tech debt:**
- `decrypt` 接口在解锁态无条件返回明文 → 未来可考虑限制调用方或增加二次确认
- settings.js line 366/596 的 `el.innerHTML = '✓ ' + address` 虽然 address 来自本地计算（非外部），但模式上仍是 innerHTML，未来可统一改为 textContent

**Next steps:**
- 部署 FreedomRouter v6.1 到 BSC 主网
- 考虑限制 background decrypt 接口的暴露面

---

## 2026-03-09 — 安全简化：移除改密码功能，改为忘记密码全量重置

**Scope:** security fix

**Changes:**
1. **移除改密码功能** — 改密码需要重加密所有链的钱包密文，逻辑复杂且容易出错（此前已出现只处理 BSC 不处理 SOL 的严重 bug）。改为不支持改密码，忘记密码唯一路径是"抹除所有数据重新使用"。
2. **新增 `resetAll` 接口** — `background.js` 新增 `resetAll` handler，调用 `chrome.storage.local.clear()` 清除所有扩展数据（钱包、密码哈希、salt、RPC 配置等），同时清除内存中的 `cachedKey`。
3. **UI 调整** — 解锁面板增加"忘记密码"按钮（`btn-danger` 样式），点击后两次 `confirm` 确认才执行。已解锁状态下移除"修改密码"按钮。改密码面板 HTML 和所有关联 JS 函数/事件绑定全部删除。

**Files touched:**
- `trader-extension/background.js` — `changePassword` handler 替换为 `resetAll`
- `trader-extension/src/crypto.js` — `changePassword` 导出替换为 `resetAll`
- `trader-extension/src/settings.js` — 删除 `showChangePwPanel`/`cancelChangePw`/`handleChangePassword`，新增 `handleResetAll`；删除 `pwChange` 面板引用
- `trader-extension/src/settings.html` — 删除 `pwChange` 面板和"修改密码"按钮；解锁面板加"忘记密码"按钮

**Decisions & rationale:**
- 不支持改密码 → 消除了重加密逻辑的全部攻击面和 bug 风险；密码学软件的最安全做法就是减少复杂操作
- 两次 confirm → 防止误操作，因为重置不可逆
- "忘记密码"按钮放在解锁面板而非已解锁面板 → 用户忘记密码时看到的就是解锁面板

**Next steps:**
- 部署 FreedomRouter v6.1 到 BSC 主网

---

## 2026-03-09 — 插件 + 部署脚本同步 v6.1 合约变更

**Scope:** sync

**Changes:**
1. **constants.js** — `ROUTE` 枚举与合约 v6.1 对齐：新增 `FLAP_BONDING_SELL: 5`，`FLAP_DEX` 从 5 改为 6，`PANCAKE_ONLY` 从 6 改为 7
2. **trading.js** — `_isFlap()` 扩展包含 `FLAP_BONDING_SELL`；`_useRouterQuote()` 拆为 `_useRouterQuoteBuy()` / `_useRouterQuoteSell()` 两个方向感知函数：买入只有 `FLAP_BONDING` 走 Router 报价（`FLAP_BONDING_SELL` 买入走 PancakeSwap），卖出 `FLAP_BONDING` + `FLAP_BONDING_SELL` 都走 Router 报价
3. **token-bsc.js** — `isFlap` 判断包含 `FLAP_BONDING_SELL`；badge 显示为"🦋 Flap 内盘(仅卖)"；`_routeLabel` 增加对应项；`showBscLPInfo` 中 `isFlapBonding` 包含新枚举
4. **ui.js** — `_updatePriceImpl` 中 `useRouterQuote` 拆为方向感知：buy 走 `useRouterQuoteBuy`，sell 走 `useRouterQuoteSell`
5. **deploy.js** — 版本标记从 v5 更新为 v6.1，注释和 deployment.json version 同步

**Files touched:**
- `trader-extension/src/constants.js`
- `trader-extension/src/trading.js`
- `trader-extension/src/token-bsc.js`
- `trader-extension/src/ui.js`
- `FreedomRouter/scripts/deploy.js`

**Verification:**
- `cd trader-extension && npm run build` → 成功
- `cd FreedomRouter && npx hardhat compile --force` → 23 files 成功

**Next steps:**
- 部署 FreedomRouter v6.1 到 BSC 主网
- 更新 FREEDOM_ROUTER 地址到 constants.js

---

## 2026-03-09 — Background 签名架构：前端适配（BSC + SOL）

**Scope:** refactor (security)

**Changes:**
1. **token-bsc.js 适配** — `firstWallet?.account.address` 和 `e.wc.account.address` 改为 `.address`，因为 `state.walletClients` 现在只存 `{ address }` 而非 `{ client, account }`
2. **sol-trading.js 适配** — `state.solKeypairs.get()` 改为 `state.solAddresses.get()`，`buy/sell` 调用签名改为 `(walletId, publicKey, ...)` 匹配底层已改造的 `sol/trading.js`；移除未使用的 `loadKeypair` 导入
3. **全局 solKeypairs→solAddresses 重命名** — `wallet.js`、`ui.js`、`batch.js`、`token-sol.js` 中所有 `state.solKeypairs` 引用统一改为 `state.solAddresses`
4. **token-sol.js 变量名修正** — `activeKeypairs` 改为 `activeWallets`，`e.kp.publicKey` 改为 `e.pk`（现在 `pk` 直接就是 `PublicKey`）
5. **清理已删除导出的引用** — `trader.js` 移除未使用的 `privateKeyToAccount` 和 `decryptPrivateKey` 导入；`settings.js` 移除未使用的 `decryptPrivateKey` 导入

**Files touched:**
- `trader-extension/src/token-bsc.js` — `.account.address` → `.address`（2 处）
- `trader-extension/src/sol-trading.js` — solKeypairs→solAddresses + buy/sell 签名改为 (walletId, publicKey, ...)
- `trader-extension/src/wallet.js` — solKeypairs→solAddresses（2 处）
- `trader-extension/src/ui.js` — solKeypairs→solAddresses（1 处）
- `trader-extension/src/batch.js` — solKeypairs→solAddresses（1 处）
- `trader-extension/src/token-sol.js` — solKeypairs→solAddresses + kp.publicKey→pk
- `trader-extension/src/trader.js` — 移除 privateKeyToAccount + decryptPrivateKey 导入
- `trader-extension/src/settings.js` — 移除 decryptPrivateKey 导入

**Decisions & rationale:**
- `wallet-bsc.js`、`trading.js`、`wallet-sol.js`、`state.js`、`crypto.js` 的核心改造已在前一 session 完成，本次只做"适配层"收尾
- `sol-trading.js` 传 `(walletId, publicKey)` 而非 keypair → 底层 `sol/trading.js` 已改为用 `solSignAndSend` 发送给 background 签名

**Verification:**
- `cd trader-extension && npm run build` → 成功（trader.js + settings.js + background.js 全部通过）
- 全局搜索 `state.solKeypairs`、`decryptPrivateKey`、前端 `wc.client.writeContract` → 无残留

**Next steps:**
- 部署 FreedomRouter v6.1 到 BSC 主网
- 完成 SOL 交易签名的 background 代理改造（sol/trading.js 的 signSendConfirm）
- 端到端测试 BSC + SOL 交易流程

---

## 2026-03-09 — Background 签名架构完成：私钥完全封闭在 service worker 内

**Scope:** security / refactor

**Changes:**
1. **Build 系统** — `background.js` 从 `STATIC_FILES` 移除，改为 esbuild 入口打包（`src/background.js` → `dist/background.js`）。这使 background 可以 `import` viem + @solana/web3.js 等 npm 包。
2. **Background 重构** — 完整重写 `src/background.js`：导入 viem（createPublicClient/createWalletClient/privateKeyToAccount）和 @solana/web3.js（Keypair/Transaction/Connection）+ bs58。内部持有 `bscClients` Map 和 `solKeypairs` Map。新增 `initWallets`（解密所有钱包并创建签名客户端，仅返回地址映射）、`bscWriteContract`（接收合约调用参数，内部签名发送，返回 txHash）、`solSignAndSend`（接收序列化 TX，内部签名并通过 RPC+Jito 广播，返回 signature）。删除 `decryptWalletKey` handler。
3. **Crypto 代理层** — `crypto.js` 删除 `decryptPrivateKey`，新增 `initWallets(rpcUrl)`、`bscWriteContract(walletId, params)`、`solSignAndSend(walletId, params)` 代理函数。
4. **BSC 钱包初始化** — `wallet-bsc.js` 的 `initWalletClients()` 改为调用 `initWallets()`，`state.walletClients` 现在只存 `Map<id, { address }>`，不再持有签名能力。结果缓存到 `state._initWalletsResult` 供 SOL 初始化复用。
5. **BSC 交易签名** — `trading.js` 的 `buy`/`sell`/`ensureApproved` 全部改为通过 `bscWriteContract(walletId, {...})` 代理。`ensureApproved` 签名改为接收 `(walletId, ownerAddress, ...)` 而非 `(wc, ...)`。
6. **SOL 钱包初始化** — `wallet-sol.js` 不再解密私钥或创建 Keypair，改为从 `_initWalletsResult` 中取 SOL 地址，`state.solAddresses` 存 `Map<id, PublicKey>`。
7. **SOL 交易签名** — `sol/trading.js` 的 `signSendConfirm` 改为 `buildAndSend`：构建完整 Transaction（含 instructions + blockhash + feePayer），序列化为 base64（unsigned），发送给 background 的 `solSignAndSend` 签名并广播。`buy`/`sell` 签名改为接收 `(walletId, publicKey, ...)` 而非 `(keypair, ...)`。Jito 广播逻辑移入 background。
8. **sol-trading.js** — `state.solKeypairs.get()` → `state.solAddresses.get()`，传 `(walletId, publicKey)` 给底层。
9. **初始化顺序修正** — `trader.js` 中 `initBsc` 必须先于 `initSol` 完成（因为 `initBsc` 触发 `initWallets` 同时创建 BSC+SOL 钱包），不再并行执行。

**Files touched:**
- `trader-extension/scripts/build.js` — 新增 background.js esbuild 入口，从 STATIC_FILES 移除
- `trader-extension/background.js` → `trader-extension/src/background.js` — 移动并完整重写
- `trader-extension/src/crypto.js` — 删除 decryptPrivateKey，新增 initWallets/bscWriteContract/solSignAndSend
- `trader-extension/src/wallet-bsc.js` — initWalletClients 改为调用 initWallets，只存地址
- `trader-extension/src/trading.js` — writeContract 改为 bscWriteContract 代理
- `trader-extension/src/wallet-sol.js` — 不再创建 Keypair，改为读取地址映射
- `trader-extension/src/sol/trading.js` — signSendConfirm → buildAndSend，TX 序列化后发给 background
- `trader-extension/src/sol-trading.js` — solKeypairs → solAddresses，传 walletId+publicKey
- `trader-extension/src/trader.js` — 修正 initBsc/initSol 执行顺序

**Decisions & rationale:**
- background.js 纳入 esbuild → 唯一能让 service worker 引用 npm 包的方式（MV3 不支持 importScripts 加载 ESM）
- 单次 `initWallets` 调用同时初始化 BSC+SOL → 避免两次解密遍历，结果缓存复用
- SOL TX 序列化方案：前端构建完整 Transaction（含所有 instructions），serialize 为 base64 unsigned，background 反序列化后签名发送 → 最小改动量，前端 instruction 构建逻辑完全不变
- Jito 广播移入 background → 签名后的 raw TX 不需要再传回前端
- `ensureApproved` 拆分 walletId 和 ownerAddress 参数 → address 用于读操作（allowance 查询），walletId 用于写操作（approve TX）

**Verification:**
- `cd trader-extension && npm run build` → 成功，trader.js + settings.js + background.js 全部通过
- background.js 打包后 36K 行（含 viem + @solana/web3.js）
- 全局搜索 `decryptPrivateKey`、前端 `wc.client.writeContract`、`state.solKeypairs` → 无残留

**Security improvement:**
- 前端（side panel pages）完全无法接触私钥明文
- `decryptWalletKey` handler 已删除 → background 不再提供任何解密接口
- 即使 XSS 攻击成功注入脚本，也无法获取私钥或直接签名（需要通过 `bscWriteContract`/`solSignAndSend` handlers，且必须提供有效的 walletId）

**Next steps:**
- 端到端测试 BSC + SOL 交易流程（加载扩展、解锁、检测代币、买入卖出）
- 部署 FreedomRouter v6.1 到 BSC 主网

---

## 2026-03-09 — Background 签名架构收尾：SOL TX 序列化修正 + 引用清理

**Scope:** refactor (security)

**Changes:**
1. **state.js** — `solKeypairs` 重命名为 `solAddresses`（Map<id, PublicKey>），确保全局一致
2. **sol/trading.js** — 移除 `loadKeypair` export（前端不再需要）；移除 `sendToJito` 函数和 `JITO_BLOCK_ENGINES` 导入（Jito 广播已在 background 处理）；`conn._rpcEndpoint` 改为 `conn.rpcEndpoint`（使用公开 getter）
3. **sol-trading.js** — `state.solKeypairs.get()` → `state.solAddresses.get()`，传 `(walletId, pubkey)` 给底层 `buy/sell`
4. **wallet-sol.js** — 完全重写：不再导入 `Keypair`/`bs58`/`decryptPrivateKey`，改为从 `initWallets()` 返回值（或 `_initWalletsResult` 缓存）构建 `state.solAddresses`
5. **background.js** — `solSignAndSend` 中 `Transaction.from()` 保持不变（匹配前端 `tx.serialize({ requireAllSignatures: false })` 的全格式序列化），回退了误改的 `Message.from` 方案

**Files touched:**
- `trader-extension/src/state.js` — `solKeypairs` → `solAddresses`
- `trader-extension/src/sol/trading.js` — 移除 loadKeypair/sendToJito，修正 rpcEndpoint 引用
- `trader-extension/src/sol-trading.js` — solKeypairs → solAddresses
- `trader-extension/src/wallet-sol.js` — 重写为地址-only 初始化
- `trader-extension/src/background.js` — solSignAndSend 保持 Transaction.from 方案

**Decisions & rationale:**
- 前端 `tx.serialize({ requireAllSignatures: false })` 产生完整 wire format（含空签名槽），background `Transaction.from()` 直接反序列化 → 最可靠的方案，无需 Message.populate 的额外处理
- wallet-sol.js 复用 `_initWalletsResult` 缓存 → 避免第二次 background 往返

**Verification:**
- `cd trader-extension && npm run build` → 成功
- 全局搜索 `state.solKeypairs`、`decryptPrivateKey` → 仅 background.js 有 solKeypairs（正确）
- 全局搜索前端 `Keypair` 导入 → 仅 settings.js（钱包验证用，符合预期）

**Next steps:**
- 端到端测试 BSC + SOL 交易流程
- 部署 FreedomRouter v6.1 到 BSC 主网

---

## 2026-03-09 — Bugfix: BSC 交易 BigInt 序列化失败

**Scope:** bugfix

**Changes:**
1. **crypto.js** — 新增 `serializeArg()` 递归函数，在发送 `bscWriteContract` 消息前将 `args` 中的 BigInt 转换为 `{ __bigint: "123" }` 标记对象，避免 `chrome.runtime.sendMessage` 的 structured clone 抛出 `Could not serialize message`
2. **background.js** — 新增 `deserializeArg()` 递归函数，在 `bscWriteContract` handler 中将 `{ __bigint: "..." }` 还原为 BigInt；同时修正 `solConnection._rpcEndpoint` → `solConnection.rpcEndpoint`（使用公开 getter）

**Files touched:**
- `trader-extension/src/crypto.js` — 新增 serializeArg，args 序列化
- `trader-extension/src/background.js` — 新增 deserializeArg，args 反序列化；修正 rpcEndpoint 访问

**Decisions & rationale:**
- 使用 `{ __bigint: "..." }` 标记对象而非一律 `.toString()` → args 中混合了 address (string) 和数值 (BigInt)，全部 toString 后 background 无法区分哪些需要还原为 BigInt，标记对象方案类型安全且可递归处理嵌套数组

**Verification:**
- `cd trader-extension && npm run build` → 成功
- 涉及的三处调用（approve/buy/sell）的 args 类型均覆盖：string 直通、BigInt 标记转换

**Next steps:**
- 端到端测试 BSC 交易流程（approve + buy + sell）
- 部署 FreedomRouter v6.1 到 BSC 主网

---

## 2026-03-09 — FreedomRouter v6.1 部署 + 合约 bug 修复

**Scope:** bugfix + deployment

**Changes:**
1. **合约 bug 诊断** — 旧 proxy (`0x7451...`) 的 implementation 缺少 UUPS 升级能力，且 `_buyPancake` 传给 PancakeRouter 的 deadline=0，导致所有 PancakeSwap 路径（FOUR_EXTERNAL、PANCAKE_ONLY、FLAP_DEX）的买入 revert `PancakeRouter: EXPIRED`。通过 `cast --trace` 追踪到链上 delegatecall 中 deadline 参数被传为 0
2. **全新部署** — 旧 proxy 不可升级（旧 impl 无 UUPS），部署全新 proxy + implementation：
   - Proxy: `0x6d2948d22aA6da3C3F29768131b4F76f3eB7B42d`
   - Implementation v1: `0x396278907e3eE091c62305224101398577C010f2`
3. **`_buyFlap` 下溢修复** — `ethBefore` 在发送 value 给 Portal 之前记录，swap 后余额 < ethBefore 导致 `address(this).balance - ethBefore` 下溢 panic。修复：改为 `ethBeforeSwap = address(this).balance - value`，swap 后比较 `ethAfter > ethBeforeSwap`
4. **UUPS 升级** — 修复后编译、部署新 impl (`0x80c47EA9...`)、通过 proxy `upgradeToAndCall` 升级成功
5. **test.js 修复** — 参数顺序从旧版 `(token, amountOutMin, deadline, tipRate)` 改为新版 `(token, amountOutMin, tipRate, deadline)`；`_getApproveTarget` 改为直接使用合约返回的 `approveTarget` 字段
6. **constants.js** — `FREEDOM_ROUTER` 更新为新 proxy 地址

**Files touched:**
- `FreedomRouter/contracts/FreedomRouter.sol` — `_buyFlap` 下溢修复
- `FreedomRouter/scripts/upgrade.js` — 新增 UUPS 升级脚本
- `FreedomRouter/scripts/test.js` — 参数顺序修复、approveTarget 修复、默认 ROUTER 地址
- `trader-extension/src/constants.js` — FREEDOM_ROUTER 地址更新

**测试结果（6 种路由全部通过）:**
- Four 外盘 BNB (`0x3e09...4444`): 买入 ✓ 卖出 ✓
- Four 外盘 USD1 (`0x6bdc...4444`): 买入 ✓ 卖出 ✓
- Four 内盘 BNB (`0x1dd9...4444`): 买入 ✓ 卖出 ✓
- Four 内盘 USD1 带税 (`0xabf6...ffff`): 买入 ✓ 卖出 ✓
- Flap 内盘 (`0xf9eb...7777`): 买入 ✓ 卖出 ✓
- Flap 外盘 (`0x07f6...7777`): 买入 ✓ 卖出 ✓

**Decisions & rationale:**
- 全新部署而非升级旧 proxy → 旧 impl 完全没有 UUPS 能力，ERC1967Proxy 没有 admin 方法
- `ethBeforeSwap = balance - value` 而非 swap 后记录 → 更精确捕获 Portal 退款

**Next steps:**
- 插件端到端测试（通过 Chrome 扩展完整流程）
- 考虑 BSCScan 验证新合约

---

## 2026-03-09 — 靓号 Proxy 定版 + 文档清理

**Scope:** docs + config

**Changes:**
- 最终确定 BSC 主网 Proxy 为 `0x444444444444147c48E01D3669260E33d8b33c93`，并完成 BscScan 上 Proxy / Impl 源码验证
- 插件 `FREEDOM_ROUTER` 已切换到最终地址，README 与脚本默认地址同步更新
- 清理 vanity 流程文档：保留 `prepare-vanity.js` + `deploy-vanity.js` 的两步流程，补充 CREATE2 靓号部署说明
- 新增根目录更新公告 `UPDATE-2026-03-09.md`，用于 GitHub 发布前预览

**Files touched:**
- `README.md` — 更新主网地址、Flap 支持说明、2026-03 更新摘要
- `FreedomRouter/README.md` — 重写为 v6 文档，补充 CREATE2 / UUPS / 路由枚举 / 当前主网地址
- `trader-extension/README.md` — 更新双链描述与最新合约地址
- `FreedomRouter/scripts/test.js` — 默认 ROUTER 地址改为最终 Proxy
- `FreedomRouter/scripts/upgrade.js` — 默认 PROXY 地址改为最终 Proxy
- `UPDATE-2026-03-09.md` — 新增更新公告草稿

**Decisions & rationale:**
- 最终采用 `0x444444444444...` Proxy 作为对外地址 → 已完成链上部署、源码验证，且后续可通过 UUPS 热升级保持地址稳定
- 文档优先写当前有效流程，不再保留 v4 / 旧 Proxy 叙述 → 降低后续部署与使用时的误导风险

**Known issues / tech debt:**
- DEVLOG 中仍保留历史旧 Proxy 记录，属于时间线的一部分，不做覆盖
- 矿机大 salt 结果曾出现错误匹配，仍需在 GPU 端单独修复或规避

**Next steps:**
- 预览更新公告与 README，如需调整措辞再提交
- 用户确认后再执行 git commit

---

## 2026-03-09 — 敏感配置清理与提交范围收口

**Scope:** config

**Changes:**
- 删除本地 `FreedomRouter/.env`，避免私钥和 BscScan API key 误入仓库
- 在根目录与 `FreedomRouter/.gitignore` 中补充 `vanity-params.json` 忽略规则，避免 CREATE2 部署参数文件误上传
- 保留合约与部署脚本在本地工作区，但后续提交时不纳入 GitHub 提交范围

**Files touched:**
- `.gitignore` — 增加 `FreedomRouter/vanity-params.json`
- `FreedomRouter/.gitignore` — 增加 `vanity-params.json`

**Decisions & rationale:**
- 敏感配置直接删除优先于保留示例值 → 防止后续误提交真实私钥/API key
- 合约与部署脚本暂不删除本地文件 → 便于后续继续开发或回查，但本次不准备上传

**Known issues / tech debt:**
- 当前工作区仍有较多合约与部署相关改动，需要在提交时明确排除

**Next steps:**
- 确认最终提交范围，只提交插件与文档相关内容

---

## 2026-03-09 — 插件发布前收口与安全说明强化

**Scope:** docs + release

**Changes:**
- 将本次提交范围收口为插件代码 + 说明文档，不包含合约源码与部署脚本
- 强化 `README.md`、`trader-extension/README.md`、`UPDATE-2026-03-09.md` 中的安全性描述，突出本地加密、自动锁定、`deadline`、`approveTarget`、隐私 RPC 与 BscScan 验证
- 重新执行 `trader-extension` 构建，确认当前发布版本可正常打包

**Files touched:**
- `README.md` — 增补安全性章节与 2026-03 安全更新说明
- `trader-extension/README.md` — 增补安全路由、时效保护与本次版本升级重点
- `UPDATE-2026-03-09.md` — 增加“安全性重点”章节

**Decisions & rationale:**
- 本次作为大版本更新，发布说明优先强调“安全性 + 可审计性”，而不是只讲新功能
- 合约与部署脚本保留在本地，避免和插件发布内容混在同一次提交中

**Next steps:**
- 提交插件代码与说明文档

---

## 2026-03-09 — 安全表述统一为“本地后台持钥”

**Scope:** docs

**Changes:**
- 将发布说明中的安全核心表述统一为：私钥不上传服务器，只在本地浏览器插件后台解密和使用
- 在主 README、插件 README、更新公告中明确补充“前端页面拿不到私钥明文”的说明

**Files touched:**
- `README.md` — 安全性章节强调“本地后台持钥”
- `trader-extension/README.md` — 新增“第一原则”段落，突出后台隔离使用
- `UPDATE-2026-03-09.md` — 将“私钥不上传服务器”提升为安全性重点第一条

**Decisions & rationale:**
- “本地加密”本身不够直观，用户更关心私钥是否会上传到服务器
- 发布文案优先回答最核心的信任问题：私钥只在本地后台使用，不由远端托管
