// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * Four.meme 统一路由 (BSC)
 * - 内盘 BNB 池: Proxy buy / Proxy swap
 * - 内盘 USD1 池: Helper3.buyWithEth, TokenManager2.sellToken + Pancake USD1->BNB
 * - 外盘/纯 Pancake: Router swap
 */

address constant HELPER3 = 0xF251F83e40a78868FcfA3FA4599Dad6494E46034;
address constant TOKEN_MANAGER2 = 0x5c952063c7fc8610FFDB798152D69F0B9550762b;
address constant FOUR_MEME_PROXY = 0x593445503aca66cc316a313b6f14a1639da1e484;
address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
address constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
address constant PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;

interface IHelper3 {
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
        bool liquidityAdded
    );
    function buyWithEth(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable;
}

interface ITokenManager2 {
    function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external;
}

interface IPancakeRouter {
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory);
    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory);
}

interface IPancakeFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// Four.meme Proxy swap(descs, feeToken, amountIn, minReturn)
struct SwapDesc {
    bytes path;
    uint8 dexId;
    address tokenAddr;
    uint256 poolIndex;
    uint256 amountIn;
    uint256 minOut;
    uint256 deadline;
    uint256 feeRate;
    address feeRcv;
    bytes32 affiliate;
}

interface IFourMemeProxy {
    function swap(SwapDesc[] calldata descs, address feeToken, uint256 amountIn, uint256 minReturn) external payable;
}

contract FourMemeRouter {
    address public owner;
    uint256 public feeBps;

    error NoPool();
    error ProxyBuyFailed();
    error NoQuoteReceived();
    error Slippage();
    error SendFailed();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        feeBps = _feeBps;
    }

    enum PoolType {
        NOT_FOUND,
        FOUR_MEME_BNB,
        FOUR_MEME_USD1,
        FOUR_MEME_EXTERNAL,
        PANCAKE_ONLY
    }

    function detectPoolType(address token) public view returns (PoolType poolType, address quote) {
        try IHelper3(HELPER3).getTokenInfo(token) returns (
            uint256 version,
            address tokenManager,
            address _quote,
            uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256,
            bool liquidityAdded
        ) {
            if (version == 2 && tokenManager != address(0)) {
                if (liquidityAdded) {
                    return (PoolType.FOUR_MEME_EXTERNAL, _quote);
                }
                if (_quote == address(0)) {
                    return (PoolType.FOUR_MEME_BNB, address(0));
                }
                return (PoolType.FOUR_MEME_USD1, _quote);
            }
        } catch {}
        address pair = IPancakeFactory(PANCAKE_FACTORY).getPair(token, WBNB);
        if (pair != address(0)) {
            return (PoolType.PANCAKE_ONLY, WBNB);
        }
        return (PoolType.NOT_FOUND, address(0));
    }

    function buy(address token, uint256 minTokenOut) external payable {
        (PoolType poolType, address quote) = detectPoolType(token);
        if (poolType == PoolType.NOT_FOUND) revert NoPool();

        uint256 value = msg.value;
        if (feeBps > 0) {
            uint256 fee = (value * feeBps) / 10000;
            value -= fee;
            (bool ok,) = owner.call{value: fee}("");
            require(ok);
        }

        if (poolType == PoolType.FOUR_MEME_BNB) {
            _buyFourMemeBnbInternal(token, value, minTokenOut);
        } else if (poolType == PoolType.FOUR_MEME_USD1) {
            IHelper3(HELPER3).buyWithEth{value: value}(0, token, msg.sender, value, minTokenOut);
        } else {
            _buyPancake(token, quote, value, minTokenOut);
        }
    }

    function _buyFourMemeBnbInternal(address token, uint256 value, uint256 minTokenOut) internal {
        bytes memory data = _encodeProxyBuy(value, minTokenOut, token);
        (bool ok,) = FOUR_MEME_PROXY.call{value: value}(data);
        if (!ok) revert ProxyBuyFailed();
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
            path = new address[](3);
            path[0] = WBNB;
            path[1] = quoteToken;
            path[2] = token;
        }
        IPancakeRouter(PANCAKE_ROUTER).swapExactETHForTokens{value: value}(
            minTokenOut, path, msg.sender, block.timestamp + 300
        );
    }

    function sell(address token, uint256 amount, uint256 minBnbOut) external {
        (PoolType poolType, address quote) = detectPoolType(token);
        if (poolType == PoolType.NOT_FOUND) revert NoPool();

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        if (poolType == PoolType.FOUR_MEME_BNB) {
            _sellFourMemeBnbInternal(token, amount, minBnbOut);
        } else if (poolType == PoolType.FOUR_MEME_USD1) {
            _sellFourMemeUsd1Internal(token, quote, amount, minBnbOut);
        } else {
            _sellPancake(token, quote, amount, minBnbOut);
        }
        _sendBnbToSender(minBnbOut);
    }

    function _sellFourMemeBnbInternal(address token, uint256 amount, uint256 minBnbOut) internal {
        IERC20(token).approve(FOUR_MEME_PROXY, amount);
        uint256 deadline = block.timestamp + 1200;
        SwapDesc[] memory descs = new SwapDesc[](1);
        descs[0] = SwapDesc({
            path: "",
            dexId: 5,
            tokenAddr: token,
            poolIndex: 0,
            amountIn: amount,
            minOut: minBnbOut,
            deadline: deadline,
            feeRate: 0,
            feeRcv: address(0),
            affiliate: bytes32(0)
        });
        IFourMemeProxy(FOUR_MEME_PROXY).swap(descs, address(0), amount, minBnbOut);
    }

    function _sellFourMemeUsd1Internal(address token, address quoteToken, uint256 amount, uint256 minBnbOut) internal {
        IERC20(token).approve(TOKEN_MANAGER2, amount);
        ITokenManager2(TOKEN_MANAGER2).sellToken(0, token, amount, 0, 0, address(0));
        uint256 quoteBal = IERC20(quoteToken).balanceOf(address(this));
        if (quoteBal == 0) revert NoQuoteReceived();
        IERC20(quoteToken).approve(PANCAKE_ROUTER, quoteBal);
        address[] memory path = new address[](2);
        path[0] = quoteToken;
        path[1] = WBNB;
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
        if (bnbBal < minBnbOut) revert Slippage();
        (bool sent,) = msg.sender.call{value: bnbBal}("");
        if (!sent) revert SendFailed();
    }

    uint256 private constant PROXY_BUY_WORD2_OFFSET = 4 + 2 * 32;
    uint256 private constant PROXY_BUY_WORD3_OFFSET = 4 + 3 * 32;
    uint256 private constant PROXY_BUY_WORD8_OFFSET = 4 + 8 * 32;
    uint256 private constant PROXY_BUY_WORD20_OFFSET = 4 + 20 * 32;
    uint256 private constant PROXY_BUY_WORD21_OFFSET = 4 + 21 * 32;

    function _encodeProxyBuy(uint256 amountIn, uint256 minOut, address token) internal pure returns (bytes memory) {
        bytes memory template = _proxyBuyTemplate();
        bytes memory data = new bytes(4 + 23 * 32);
        data[0] = 0x0b;
        data[1] = 0x3f;
        data[2] = 0x5c;
        data[3] = 0xf9;
        for (uint256 i = 0; i < 736; i++) {
            data[i + 4] = template[i];
        }
        _writeUint256(data, PROXY_BUY_WORD2_OFFSET, amountIn);
        _writeUint256(data, PROXY_BUY_WORD3_OFFSET, minOut);
        _writeAddress(data, PROXY_BUY_WORD8_OFFSET, token);
        _writeUint256(data, PROXY_BUY_WORD20_OFFSET, 0);
        _writeAddress(data, PROXY_BUY_WORD21_OFFSET, address(0));
        return data;
    }

    function _writeUint256(bytes memory data, uint256 offset, uint256 value) private pure {
        assembly {
            mstore(add(add(data, 32), offset), value)
        }
    }

    function _writeAddress(bytes memory data, uint256 offset, address value) private pure {
        assembly {
            mstore(add(add(data, 32), offset), shr(96, shl(96, value)))
        }
    }

    function _proxyBuyTemplate() private pure returns (bytes memory) {
        return hex"0000000000000000000000000000000000000000000000000000000000000080"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"000000000000000000000000000000000000000000000000016345785d8a0000"
            hex"0000000000000000000000000000000000000000000000c7bf38eaf75afbaa4760"
            hex"0000000000000000000000000000000000000000000000000000000000000001"
            hex"0000000000000000000000000000000000000000000000000000000000000020"
            hex"0000000000000000000000000000000000000000000000000000000000000005"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"000000000000000000000000d5c978fbae1522089bf05643c0e8043d2fed4444"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000140"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"000000000000000000000000009db698954f6d4d1e4e33a827b7b5d8e801f61b63"
            hex"0000000000000000000000000000000000000000000000000000000000000000";
    }

    receive() external payable {}
}
