// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title FreedomRouterImpl v4
 * @notice FreedomRouter — 完全免费的 Four.meme 聚合路由
 *
 *   架构: 用户 → Proxy(delegatecall) → Impl → TM_V1 / TM_V2 / Helper3 / PancakeSwap
 *
 *   v4 重构:
 *   - 通过 Helper3.getTokenInfo 精确判断 token 的 TM 版本和 quote 类型
 *   - BNB 计价内盘: 直接调对应版本 TM
 *   - ERC20 计价内盘 (USD1/USDT): 调 Helper3.buyWithEth / sellForEth 自动换算
 *   - 外盘: PancakeSwap 多底池扫描 (WBNB/USDT/USD1/USDC/BUSD/FDUSD)
 *   - 完整 TaxToken 信息查询
 */
contract FreedomRouterImpl is Ownable, ReentrancyGuard, Initializable {
    using SafeERC20 for IERC20;

    // ==================== 常量 ====================

    address public constant WBNB  = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant ETH   = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public constant USDT  = 0x55d398326f99059fF775485246999027B3197955;
    address public constant USD1  = 0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d;
    address public constant USDC  = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address public constant BUSD  = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;
    address public constant FDUSD = 0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409;

    address public constant PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address public constant PANCAKE_ROUTER  = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant DEV = 0x2De78dd769679119b4B3a158235678df92E98319;

    uint256 public constant MAX_TIP = 500; // 5%

    // ==================== 存储 ====================

    address public tokenManagerV1;
    address public tokenManagerV2;
    address public tmHelper3;

    // ==================== 数据结构 ====================

    struct TokenInfo {
        string symbol;
        uint8 decimals;
        uint256 totalSupply;
        uint256 userBalance;
        // Four.meme 状态
        uint256 mode;           // _mode(): 0=NORMAL, 1=RESTRICTED, 2=CONTROLLED
        bool isInternal;        // mode != 0 → 内盘
        bool tradingHalt;
        uint256 tmVersion;      // Helper3 返回: 1=V1, 2=V2, 0=非 four 代币
        address tmAddress;      // 管理该代币的 TM 地址
        address tmQuote;        // TM 的计价代币 (address(0)=BNB, 其他=ERC20)
        uint256 tmStatus;
        uint256 tmFunds;
        uint256 tmMaxFunds;
        uint256 tmOffers;
        uint256 tmMaxOffers;
        uint256 tmLastPrice;
        uint256 tmLaunchTime;
        uint256 tmTradingFeeRate;
        bool tmLiquidityAdded;
        // TaxToken 信息
        bool isTaxToken;
        uint256 taxFeeRate;
        // PancakeSwap 外盘
        address pair;
        address quoteToken;
        uint256 pairReserve0;
        uint256 pairReserve1;
        bool hasLiquidity;
    }

    // ==================== 事件 ====================

    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint8 swapType  // 0=内盘买, 1=内盘卖, 2=外盘买, 3=外盘卖
    );

    event ConfigUpdated(string key, address oldVal, address newVal);
    event TokensRescued(address indexed token, uint256 amount);

    // ==================== 初始化 ====================

    constructor() Ownable(msg.sender) {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _tmV1,
        address _tmV2,
        address _helper3
    ) external initializer {
        _transferOwnership(_owner);
        tokenManagerV1 = _tmV1;
        tokenManagerV2 = _tmV2;
        tmHelper3 = _helper3;
    }

    // ==================== 核心判断 ====================

    /// @dev 通过 Helper3 获取 token 的 TM 版本、地址、quote
    function _getTokenTMInfo(address token) internal view returns (
        uint256 version, address tm, address quote, bool liquidityAdded
    ) {
        if (tmHelper3 == address(0)) return (0, address(0), address(0), false);
        try IHelper3(tmHelper3).getTokenInfo(token) returns (
            uint256 v, address _tm, address _quote,
            uint256, uint256, uint256, uint256,
            uint256, uint256, uint256, uint256,
            bool _liquidityAdded
        ) {
            return (v, _tm, _quote, _liquidityAdded);
        } catch {
            return (0, address(0), address(0), false);
        }
    }

    /// @dev 判断是否为内盘代币 (mode != 0 且 TM 存在且尚未上外盘)
    function isInternalToken(address token) public view returns (bool) {
        try IFourToken(token)._mode() returns (uint256 mode) {
            if (mode == 0) return false;
            (uint256 ver,,, bool liqAdded) = _getTokenTMInfo(token);
            return ver > 0 && !liqAdded;
        } catch {
            return false;
        }
    }

    function findBestQuote(address token) public view returns (address bestQuote, address bestPair) {
        address[6] memory quotes = [WBNB, USDT, USD1, USDC, BUSD, FDUSD];
        uint256 bestLiquidity;
        for (uint256 i = 0; i < quotes.length; i++) {
            try IPancakeFactory(PANCAKE_FACTORY).getPair(token, quotes[i]) returns (address p) {
                if (p != address(0)) {
                    try IPancakePair(p).getReserves() returns (uint112 r0, uint112 r1, uint32) {
                        uint256 liq = uint256(r0) * uint256(r1);
                        if (liq > bestLiquidity) {
                            bestLiquidity = liq;
                            bestQuote = quotes[i];
                            bestPair = p;
                        }
                    } catch {}
                }
            } catch {}
        }
    }

    // ==================== 统一入口 ====================

    /// @notice 用 BNB 买入代币 (内盘/外盘自动路由)
    function buy(address token, uint256 amountOutMin, uint256 deadline, uint256 tipRate)
        external payable nonReentrant returns (uint256 amountOut)
    {
        require(msg.value > 0, "No BNB");
        uint256 netValue = _deductTip(msg.value, tipRate);

        if (isInternalToken(token)) {
            amountOut = _buyInternal(token, amountOutMin, netValue);
            emit Swap(msg.sender, ETH, token, msg.value, amountOut, 0);
        } else {
            amountOut = _buyExternal(token, amountOutMin, deadline, netValue);
            emit Swap(msg.sender, ETH, token, msg.value, amountOut, 2);
        }
        require(amountOut >= amountOutMin, "Slippage");
    }

    /// @notice 卖出代币换 BNB (内盘/外盘自动路由)
    function sell(address token, uint256 amountIn, uint256 amountOutMin, uint256 deadline, uint256 tipRate)
        external nonReentrant returns (uint256 amountOut)
    {
        if (isInternalToken(token)) {
            amountOut = _sellInternal(token, amountIn, amountOutMin, tipRate);
            emit Swap(msg.sender, token, ETH, amountIn, amountOut, 1);
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _sellExternal(token, amountIn, amountOutMin, deadline, tipRate);
            emit Swap(msg.sender, token, ETH, amountIn, amountOut, 3);
        }
        require(amountOut >= amountOutMin, "Slippage");
    }

    // ==================== 内盘买入 ====================

    function _buyInternal(address token, uint256 amountOutMin, uint256 value) internal returns (uint256) {
        (uint256 ver, address tm, address quote,) = _getTokenTMInfo(token);
        require(ver > 0 && tm != address(0), "No TM");

        uint256 before = IERC20(token).balanceOf(msg.sender);

        if (quote == address(0)) {
            if (ver == 1) {
                ITMV1(tm).purchaseTokenAMAP{value: value}(0, token, msg.sender, value, amountOutMin);
            } else {
                ITMV2(tm).buyTokenAMAP{value: value}(token, msg.sender, value, amountOutMin);
            }
        } else {
            require(tmHelper3 != address(0), "No Helper3");
            IHelper3(tmHelper3).buyWithEth{value: value}(0, token, msg.sender, value, amountOutMin);
            _sweepResidue(quote, msg.sender);
        }

        return IERC20(token).balanceOf(msg.sender) - before;
    }

    // ==================== 内盘卖出 ====================

    function _sellInternal(address token, uint256 amountIn, uint256 amountOutMin, uint256 tipRate) internal returns (uint256) {
        (uint256 ver, address tm, address quote,) = _getTokenTMInfo(token);
        require(ver > 0 && tm != address(0), "No TM");
        uint256 rate = tipRate <= MAX_TIP ? tipRate : MAX_TIP;

        if (quote == address(0)) {
            // BNB 计价 — 直接调 TM.sellToken
            uint256 bnbBefore = msg.sender.balance;
            if (ver == 1) {
                ITMV1(tm).saleToken(token, amountIn);
            } else {
                ITMV2(tm).sellToken(0, token, msg.sender, amountIn, amountOutMin, rate, DEV);
            }
            uint256 bnbAfter = msg.sender.balance;
            return bnbAfter > bnbBefore ? bnbAfter - bnbBefore : 0;
        } else {
            require(tmHelper3 != address(0), "No Helper3");
            uint256 bnbBefore = msg.sender.balance;
            IHelper3(tmHelper3).sellForEth(0, token, msg.sender, amountIn, amountOutMin, rate, DEV);
            _sweepResidue(quote, msg.sender);
            uint256 bnbAfter = msg.sender.balance;
            return bnbAfter > bnbBefore ? bnbAfter - bnbBefore : 0;
        }
    }

    // ==================== 外盘 ====================

    function _buyExternal(address token, uint256 amountOutMin, uint256 deadline, uint256 value) internal returns (uint256) {
        (address quote,) = findBestQuote(token);

        address[] memory path;
        if (quote == WBNB || quote == address(0)) {
            path = new address[](2);
            path[0] = WBNB;
            path[1] = token;
        } else {
            path = new address[](3);
            path[0] = WBNB;
            path[1] = quote;
            path[2] = token;
        }

        uint256 balBefore = IERC20(token).balanceOf(msg.sender);
        try IPancakeRouter(PANCAKE_ROUTER)
            .swapExactETHForTokensSupportingFeeOnTransferTokens{value: value}(
                amountOutMin, path, msg.sender, deadline
            )
        {} catch {
            IPancakeRouter(PANCAKE_ROUTER)
                .swapExactETHForTokens{value: value}(amountOutMin, path, msg.sender, deadline);
        }
        return IERC20(token).balanceOf(msg.sender) - balBefore;
    }

    function _sellExternal(address token, uint256 amountIn, uint256 amountOutMin, uint256 deadline, uint256 tipRate) internal returns (uint256) {
        IERC20(token).forceApprove(PANCAKE_ROUTER, amountIn);
        (address quote,) = findBestQuote(token);

        address[] memory path;
        if (quote == WBNB || quote == address(0)) {
            path = new address[](2);
            path[0] = token;
            path[1] = WBNB;
        } else {
            path = new address[](3);
            path[0] = token;
            path[1] = quote;
            path[2] = WBNB;
        }

        uint256 bnbBefore = address(this).balance;
        try IPancakeRouter(PANCAKE_ROUTER)
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
                amountIn, amountOutMin, path, address(this), deadline
            )
        {} catch {
            IPancakeRouter(PANCAKE_ROUTER)
                .swapExactTokensForETH(amountIn, amountOutMin, path, address(this), deadline);
        }
        uint256 bnbOut = address(this).balance - bnbBefore;

        uint256 tip = _calcTip(bnbOut, tipRate);
        if (tip > 0) _sendBNB(DEV, tip);
        uint256 net = bnbOut - tip;
        if (net > 0) _sendBNB(msg.sender, net);
        return net;
    }

    // ==================== 残留扫尾 ====================

    /// @dev 把 Router 里残留的 quote ERC20 和 BNB 退给用户
    function _sweepResidue(address quote, address to) internal {
        uint256 dust = IERC20(quote).balanceOf(address(this));
        if (dust > 0) IERC20(quote).safeTransfer(to, dust);
        uint256 ethDust = address(this).balance;
        if (ethDust > 0) _sendBNB(to, ethDust);
    }

    // ==================== 小费 ====================

    function _calcTip(uint256 amount, uint256 tipRate) internal pure returns (uint256) {
        if (tipRate == 0) return 0;
        uint256 rate = tipRate <= MAX_TIP ? tipRate : MAX_TIP;
        return amount * rate / 10000;
    }

    function _deductTip(uint256 amount, uint256 tipRate) internal returns (uint256) {
        uint256 tip = _calcTip(amount, tipRate);
        if (tip > 0) _sendBNB(DEV, tip);
        return amount - tip;
    }

    function _sendBNB(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "BNB transfer failed");
    }

    // ==================== 查询 ====================

    function _getTokenInfo(address token, address user) internal view returns (TokenInfo memory info) {
        // 基础 ERC20
        try IERC20Metadata(token).symbol() returns (string memory s) { info.symbol = s; } catch {}
        try IERC20Metadata(token).decimals() returns (uint8 d) { info.decimals = d; } catch { info.decimals = 18; }
        try IERC20(token).totalSupply() returns (uint256 ts) { info.totalSupply = ts; } catch {}
        if (user != address(0)) {
            try IERC20(token).balanceOf(user) returns (uint256 b) { info.userBalance = b; } catch {}
        }

        // Four.meme 基础
        try IFourToken(token)._mode() returns (uint256 m) { info.mode = m; } catch {}
        try IFourToken(token)._tradingHalt() returns (bool h) { info.tradingHalt = h; } catch {}

        // Helper3 丰富信息
        if (tmHelper3 != address(0)) {
            try IHelper3(tmHelper3).getTokenInfo(token) returns (
                uint256 ver, address _tm, address _quote,
                uint256 lastPrice, uint256 tradingFeeRate, uint256,
                uint256 launchTime, uint256 offers, uint256 maxOffers,
                uint256 funds, uint256 maxFunds, bool liqAdded
            ) {
                info.tmVersion = ver;
                info.tmAddress = _tm;
                info.tmQuote = _quote;
                info.tmLastPrice = lastPrice;
                info.tmTradingFeeRate = tradingFeeRate;
                info.tmLaunchTime = launchTime;
                info.tmOffers = offers;
                info.tmMaxOffers = maxOffers;
                info.tmFunds = funds;
                info.tmMaxFunds = maxFunds;
                info.tmLiquidityAdded = liqAdded;
                info.isInternal = info.mode != 0 && ver > 0 && !liqAdded;
            } catch {}
        }

        // 回退: 如果 Helper3 不可用，用旧逻辑
        if (info.tmVersion == 0) {
            address tm = tokenManagerV2 != address(0) ? tokenManagerV2 : tokenManagerV1;
            if (tm != address(0)) {
                try ITMQuery(tm)._tokenInfos(token) returns (ITMQuery.TMInfo memory tmInfo) {
                    info.tmFunds = tmInfo.funds;
                    info.tmOffers = tmInfo.offers;
                    info.tmLastPrice = tmInfo.lastPrice;
                    info.tmMaxFunds = tmInfo.maxRaising;
                    info.tmLaunchTime = tmInfo.launchTime;
                    info.tmQuote = tmInfo.quote;
                    info.tmStatus = tmInfo.status;
                    info.isInternal = info.mode == 1;
                } catch {}
            }
        }

        // TaxToken 检测 (creatorType == 5)
        if (info.tmVersion == 2 && tokenManagerV2 != address(0)) {
            try ITMQuery(tokenManagerV2)._tokenInfos(token) returns (ITMQuery.TMInfo memory tmInfo) {
                uint256 creatorType = (tmInfo.template >> 10) & 0x3F;
                info.isTaxToken = (creatorType == 5);
                info.tmStatus = tmInfo.status;
            } catch {}
            if (info.isTaxToken) {
                try ITaxToken(token).feeRate() returns (uint256 fr) {
                    info.taxFeeRate = fr;
                } catch {}
            }
        }

        // PancakeSwap 外盘
        (address bestQuote, address bestPair) = findBestQuote(token);
        info.quoteToken = bestQuote;
        info.pair = bestPair;
        if (bestPair != address(0)) {
            try IPancakePair(bestPair).getReserves() returns (uint112 r0, uint112 r1, uint32) {
                info.pairReserve0 = r0;
                info.pairReserve1 = r1;
                info.hasLiquidity = (r0 > 0 && r1 > 0);
            } catch {}
        }
    }

    function getTokenInfo(address token, address user) external view returns (TokenInfo memory) {
        return _getTokenInfo(token, user);
    }

    function getTokenInfoBatch(address[] calldata tokens, address user) external view returns (TokenInfo[] memory infos) {
        infos = new TokenInfo[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            infos[i] = _getTokenInfo(tokens[i], user);
        }
    }

    // ==================== 管理 ====================

    function setTokenManagerV1(address a) external onlyOwner {
        emit ConfigUpdated("tmV1", tokenManagerV1, a);
        tokenManagerV1 = a;
    }

    function setTokenManagerV2(address a) external onlyOwner {
        emit ConfigUpdated("tmV2", tokenManagerV2, a);
        tokenManagerV2 = a;
    }

    function setHelper3(address a) external onlyOwner {
        emit ConfigUpdated("helper3", tmHelper3, a);
        tmHelper3 = a;
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == ETH) {
            uint256 bal = address(this).balance;
            uint256 toSend = amount > bal ? bal : amount;
            _sendBNB(owner(), toSend);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
        emit TokensRescued(token, amount);
    }

    receive() external payable {}
}

// ==================== Proxy ====================

contract FreedomRouter is ERC1967Proxy {
    constructor(address impl, bytes memory data) ERC1967Proxy(impl, data) {}
}

// ==================== 接口 ====================

interface IERC20Metadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IFourToken {
    function _mode() external view returns (uint256);
    function _tradingHalt() external view returns (bool);
}

interface ITaxToken {
    function feeRate() external view returns (uint256);
}

/// @dev TokenManager V1 (0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC)
interface ITMV1 {
    function purchaseTokenAMAP(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable;
    function saleToken(address token, uint256 amount) external;
}

/// @dev TokenManager V2 (0x5c952063c7fc8610FFDB798152D69F0B9550762b)
interface ITMV2 {
    function buyTokenAMAP(address token, address to, uint256 funds, uint256 minAmount) external payable;
    function sellToken(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
    function sellToken(address token, uint256 amount) external;
}

/// @dev TokenManagerHelper3 (0xF251F83e40a78868FcfA3FA4599Dad6494E46034)
interface IHelper3 {
    function getTokenInfo(address token) external view returns (
        uint256 version, address tokenManager, address quote,
        uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee,
        uint256 launchTime, uint256 offers, uint256 maxOffers,
        uint256 funds, uint256 maxFunds, bool liquidityAdded
    );
    function buyWithEth(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable;
    function sellForEth(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
    function sellForEth(uint256 origin, address token, address from, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
    function sellForEth(uint256 origin, address token, address from, address to, uint256 amount, uint256 minFunds) external;
    function tryBuy(address token, uint256 amount, uint256 funds) external view returns (
        address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost,
        uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds
    );
    function trySell(address token, uint256 amount) external view returns (
        address tokenManager, address quote, uint256 funds, uint256 fee
    );
}

interface ITMQuery {
    struct TMInfo {
        address base; address quote; uint256 template; uint256 totalSupply;
        uint256 maxOffers; uint256 maxRaising; uint256 launchTime;
        uint256 offers; uint256 funds; uint256 lastPrice; uint256 K; uint256 T; uint256 status;
    }
    function _tokenInfos(address token) external view returns (TMInfo memory);
}

interface IPancakeFactory { function getPair(address, address) external view returns (address); }
interface IPancakePair { function getReserves() external view returns (uint112, uint112, uint32); }

interface IPancakeRouter {
    function swapExactETHForTokens(uint256, address[] calldata, address, uint256) external payable returns (uint256[] memory);
    function swapExactTokensForETH(uint256, uint256, address[] calldata, address, uint256) external returns (uint256[] memory);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256, address[] calldata, address, uint256) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256, uint256, address[] calldata, address, uint256) external;
}
