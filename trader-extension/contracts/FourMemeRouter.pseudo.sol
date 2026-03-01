// SPDX-License-Identifier: MIT
// 伪代码：Four.meme 统一路由
// 支持：内盘（BNB 池 / USD1 池）、外盘（已上 PancakeSwap）、非 Four.meme 代币

// ---------- 常量 ----------
address constant HELPER3 = 0xF251F83e40a78868FcfA3FA4599Dad6494E46034;        // BSC TokenManagerHelper3
address constant TOKEN_MANAGER2 = 0x5c952063c7fc8610FFDB798152D69F0B9550762b; // TokenManager2
address constant FOUR_MEME_PROXY = 0x593445503aca66cc316a313b6f14a1639da1e484; // 内盘买 Proxy（BNB 池）
address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
address constant USD1 = 0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d;
address constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;  // PancakeSwap V2 Router
address constant PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73; // V2 Factory

// ---------- 接口（仅示意） ----------
interface IHelper3 {
    // getTokenInfo 返回：version, tokenManager, quote, lastPrice, tradingFeeRate, 
    //                   minTradingFee, launchTime, offers, maxOffers, funds, maxFunds, liquidityAdded
    function getTokenInfo(address token) external view returns (
        uint256 version,
        address tokenManager,
        address quote,
        uint256 lastPrice,
        uint256 tradingFeeRate,
        uint256 minTradingFee,
        uint256 launchTime,
        uint256 offers,
        uint256 maxOffers,
        uint256 funds,
        uint256 maxFunds,
        bool liquidityAdded   // ★ 关键字段：true = 已上外盘
    );
    function tryBuy(address token, uint256 amount, uint256 funds) external view returns (...);
    function trySell(address token, uint256 amount) external view returns (...);
    function buyWithEth(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable;
    function sellForEth(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
}

interface ITokenManager2 {
    function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
}

interface IPancakeRouter {
    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory);
    function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory);
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory);
}

interface IPancakeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IWBNB {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

// ---------- 路由合约 ----------
contract FourMemeRouter {
    address public owner;
    uint256 public feeBps;  // 例如 10 = 0.1%

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { require(msg.sender == owner); _; }

    function setFee(uint256 _feeBps) external onlyOwner { feeBps = _feeBps; }

    // ========== 枚举池类型 ==========
    enum PoolType {
        NOT_FOUND,        // 找不到池
        FOUR_MEME_BNB,    // 内盘 BNB 池（quote=0）
        FOUR_MEME_USD1,   // 内盘 USD1 池（quote=USD1）
        FOUR_MEME_EXTERNAL, // 外盘（liquidityAdded=true，已上 PancakeSwap）
        PANCAKE_ONLY      // 非 Four.meme，纯 Pancake
    }

    // ========== 池类型检测 ==========
    function detectPoolType(address token) public view returns (PoolType, address quote) {
        // 1) 尝试 Four.meme Helper3.getTokenInfo
        try IHelper3(HELPER3).getTokenInfo(token) returns (
            uint256 version, address tokenManager, address _quote, 
            uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, 
            bool liquidityAdded
        ) {
            if (version == 2 && tokenManager != address(0)) {
                // 是 Four.meme 代币
                if (liquidityAdded) {
                    // 已上外盘（PancakeSwap）
                    return (PoolType.FOUR_MEME_EXTERNAL, _quote);
                } else if (_quote == address(0)) {
                    // 内盘 BNB 池
                    return (PoolType.FOUR_MEME_BNB, address(0));
                } else {
                    // 内盘 USD1（或其他 quote）池
                    return (PoolType.FOUR_MEME_USD1, _quote);
                }
            }
        } catch {}

        // 2) 非 Four.meme，检测 Pancake 池
        address pair = IPancakeFactory(PANCAKE_FACTORY).getPair(token, WBNB);
        if (pair != address(0)) {
            return (PoolType.PANCAKE_ONLY, WBNB);
        }
        // 也可以检测 token/USD1、token/USDT 等，这里简化
        return (PoolType.NOT_FOUND, address(0));
    }

    // ========== 买入 ==========
    // 用户发 BNB，得到 meme 代币
    function buy(address token, uint256 minTokenOut) external payable {
        (PoolType poolType, address quote) = detectPoolType(token);
        require(poolType != PoolType.NOT_FOUND, "no pool");

        uint256 value = msg.value;
        if (feeBps > 0) {
            uint256 fee = (value * feeBps) / 10000;
            value -= fee;
            (bool ok,) = owner.call{value: fee}("");
            require(ok);
        }

        if (poolType == PoolType.FOUR_MEME_BNB) {
            // 内盘 BNB 池：走 Proxy buy（0x0b3f5cf9）
            _buyFourMemeBnbInternal(token, value, minTokenOut);
        } 
        else if (poolType == PoolType.FOUR_MEME_USD1) {
            // 内盘 USD1 池：Helper3.buyWithEth（BNB→USD1→token）
            IHelper3(HELPER3).buyWithEth{value: value}(0, token, msg.sender, value, minTokenOut);
        } 
        else if (poolType == PoolType.FOUR_MEME_EXTERNAL) {
            // 外盘：走 Pancake（BNB→WBNB→token）
            _buyPancake(token, quote, value, minTokenOut);
        } 
        else if (poolType == PoolType.PANCAKE_ONLY) {
            // 纯 Pancake
            _buyPancake(token, WBNB, value, minTokenOut);
        }
    }

    function _buyFourMemeBnbInternal(address token, uint256 value, uint256 minTokenOut) internal {
        // 构造 Proxy buy calldata（selector 0x0b3f5cf9，23 words 模板）
        bytes memory data = _encodeProxyBuy(value, minTokenOut, token);
        (bool ok,) = FOUR_MEME_PROXY.call{value: value}(data);
        require(ok, "proxy buy failed");
        // 若 Proxy 把代币打到本合约，需 transfer 给 msg.sender
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(msg.sender, bal);
        }
    }

    function _buyPancake(address token, address quoteToken, uint256 value, uint256 minTokenOut) internal {
        address[] memory path;
        if (quoteToken == WBNB) {
            path = new address[](2);
            path[0] = WBNB;
            path[1] = token;
        } else {
            // BNB → quoteToken → token（多跳）
            path = new address[](3);
            path[0] = WBNB;
            path[1] = quoteToken;
            path[2] = token;
        }
        IPancakeRouter(PANCAKE_ROUTER).swapExactETHForTokens{value: value}(
            minTokenOut, path, msg.sender, block.timestamp + 300
        );
    }

    // ========== 卖出 ==========
    // 用户把 meme 代币转给路由，得到 BNB
    function sell(address token, uint256 amount, uint256 minBnbOut) external {
        (PoolType poolType, address quote) = detectPoolType(token);
        require(poolType != PoolType.NOT_FOUND, "no pool");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        if (poolType == PoolType.FOUR_MEME_BNB) {
            // 内盘 BNB 池：走 Proxy swap 卖
            _sellFourMemeBnbInternal(token, amount, minBnbOut);
        } 
        else if (poolType == PoolType.FOUR_MEME_USD1) {
            // 内盘 USD1 池：TokenManager2.sellToken → USD1，再 USD1→BNB
            _sellFourMemeUsd1Internal(token, quote, amount, minBnbOut);
        } 
        else if (poolType == PoolType.FOUR_MEME_EXTERNAL) {
            // 外盘：走 Pancake
            _sellPancake(token, quote, amount, minBnbOut);
        } 
        else if (poolType == PoolType.PANCAKE_ONLY) {
            // 纯 Pancake
            _sellPancake(token, WBNB, amount, minBnbOut);
        }

        // 统一收费和转账
        _sendBnbToSender(minBnbOut);
    }

    function _sellFourMemeBnbInternal(address token, uint256 amount, uint256 minBnbOut) internal {
        // 授权 Proxy，调用 Proxy.swap（descs, feeToken=ETH, amount, minBnbOut）
        IERC20(token).approve(FOUR_MEME_PROXY, amount);
        // 构造 swap calldata，执行后 BNB 到本合约
        // ...
    }

    function _sellFourMemeUsd1Internal(address token, address quoteToken, uint256 amount, uint256 minBnbOut) internal {
        // 1) TokenManager2.sellToken 卖代币得 USD1
        IERC20(token).approve(TOKEN_MANAGER2, amount);
        ITokenManager2(TOKEN_MANAGER2).sellToken(0, token, amount, 0, 0, address(0));

        // 2) USD1 → BNB（Pancake）
        uint256 quoteBal = IERC20(quoteToken).balanceOf(address(this));
        require(quoteBal > 0, "no quote received");
        
        IERC20(quoteToken).approve(PANCAKE_ROUTER, quoteBal);
        address[] memory path = new address[](2);
        path[0] = quoteToken;
        path[1] = WBNB;
        
        // swapExactTokensForETH 把 USD1 换成 BNB
        IPancakeRouter(PANCAKE_ROUTER).swapExactTokensForETH(
            quoteBal, 0, path, address(this), block.timestamp + 300
        );
    }

    function _sellPancake(address token, address quoteToken, uint256 amount, uint256 minBnbOut) internal {
        IERC20(token).approve(PANCAKE_ROUTER, amount);
        
        address[] memory path;
        if (quoteToken == WBNB) {
            path = new address[](2);
            path[0] = token;
            path[1] = WBNB;
        } else {
            // token → quoteToken → WBNB（多跳）
            path = new address[](3);
            path[0] = token;
            path[1] = quoteToken;
            path[2] = WBNB;
        }
        IPancakeRouter(PANCAKE_ROUTER).swapExactTokensForETH(
            amount, minBnbOut, path, address(this), block.timestamp + 300
        );
    }

    function _sendBnbToSender(uint256 minBnbOut) internal {
        uint256 bnbBal = address(this).balance;
        if (feeBps > 0) {
            uint256 fee = (bnbBal * feeBps) / 10000;
            bnbBal -= fee;
            (bool ok,) = owner.call{value: fee}("");
            require(ok);
        }
        require(bnbBal >= minBnbOut, "slippage");
        (bool sent,) = msg.sender.call{value: bnbBal}("");
        require(sent);
    }

    // ========== 工具 ==========
    function _encodeProxyBuy(uint256 amountIn, uint256 minOut, address token) internal pure returns (bytes memory) {
        // 按 23 words 模板，替换 words[2]=amountIn, words[3]=minOut, words[8]=token
        // selector 0x0b3f5cf9
        return "";  // 占位
    }

    receive() external payable {}
}

/*
========== 关键逻辑说明 ==========

1. Four.meme 文档核心 API：
   - getTokenInfo(token) → 返回 liquidityAdded（bool）判断是否已上外盘
   - quote 字段：address(0) = BNB 池，非零 = USD1/其他稳定币池
   - tryBuy/trySell → 预估买卖
   - buyWithEth/sellForEth → 实际买卖（USD1 池可用）

2. 池类型判断：
   - liquidityAdded = false && quote = 0 → 内盘 BNB 池
   - liquidityAdded = false && quote ≠ 0 → 内盘 USD1 池
   - liquidityAdded = true → 外盘（已上 Pancake）

3. 买入路径：
   - 内盘 BNB 池：Proxy.buy（0x0b3f5cf9 模板）
   - 内盘 USD1 池：Helper3.buyWithEth（BNB→USD1→token 一步完成）
   - 外盘/纯 Pancake：Router.swapExactETHForTokens

4. 卖出路径：
   - 内盘 BNB 池：Proxy.swap
   - 内盘 USD1 池：TokenManager2.sellToken（token→USD1）+ Pancake（USD1→BNB）
     ★ 避开 Helper3.sellForEth（链上测试持续 revert）
   - 外盘/纯 Pancake：Router.swapExactTokensForETH

5. 外盘特殊性：
   - 一旦 liquidityAdded=true，代币已在 Pancake 上，需走 Pancake 路径
   - 可检测 token/WBNB 或 token/quote 池，选择最优路径

6. 手续费：
   - 买入时从 msg.value 扣，卖出时从收到的 BNB 扣
   - feeBps 由 owner 设置（0-100 对应 0%-1%）
*/
