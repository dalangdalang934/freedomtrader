export const DEFAULT_TIP_RATE = 0;
export const DEFAULT_RPC = 'https://bsc-dataseed.bnbchain.org';

export const FREEDOM_ROUTER = '0x444444444444147c48E01D3669260E33d8b33c93';
export const TOKEN_MANAGER_V2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const HELPER3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
export const FLAP_PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
export const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// RouteSource 枚举（与合约 v6.1 对齐）
export const ROUTE = {
  NONE: 0,
  FOUR_INTERNAL_BNB: 1,
  FOUR_INTERNAL_ERC20: 2,
  FOUR_EXTERNAL: 3,
  FLAP_BONDING: 4,
  FLAP_BONDING_SELL: 5,  // ERC20 quote + nativeSwap disabled: sell via Portal, buy via PancakeSwap
  FLAP_DEX: 6,
  PANCAKE_ONLY: 7,
};

export const HELPER3_ABI = [
  {
    name: 'tryBuy', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'funds', type: 'uint256' }],
    outputs: [
      { name: 'tokenManager', type: 'address' }, { name: 'quote', type: 'address' },
      { name: 'estimatedAmount', type: 'uint256' }, { name: 'estimatedCost', type: 'uint256' },
      { name: 'estimatedFee', type: 'uint256' }, { name: 'amountMsgValue', type: 'uint256' },
      { name: 'amountApproval', type: 'uint256' }, { name: 'amountFunds', type: 'uint256' }
    ]
  },
  {
    name: 'trySell', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [
      { name: 'tokenManager', type: 'address' }, { name: 'quote', type: 'address' },
      { name: 'funds', type: 'uint256' }, { name: 'fee', type: 'uint256' }
    ]
  },
];

export const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

export const ROUTER_ABI = [
  {
    name: 'buy', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' }, { name: 'amountOutMin', type: 'uint256' },
      { name: 'tipRate', type: 'uint256' }, { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'sell', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' }, { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' }, { name: 'tipRate', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'quoteBuy', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'quoteSell', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }, { name: 'amountIn', type: 'uint256' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    name: 'getTokenInfo', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }, { name: 'user', type: 'address' }],
    outputs: [{
      name: 'info', type: 'tuple',
      components: [
        { name: 'symbol', type: 'string' }, { name: 'decimals', type: 'uint8' },
        { name: 'totalSupply', type: 'uint256' }, { name: 'userBalance', type: 'uint256' },
        { name: 'routeSource', type: 'uint8' }, { name: 'approveTarget', type: 'address' },
        { name: 'mode', type: 'uint256' }, { name: 'isInternal', type: 'bool' },
        { name: 'tradingHalt', type: 'bool' }, { name: 'tmVersion', type: 'uint256' },
        { name: 'tmAddress', type: 'address' }, { name: 'tmQuote', type: 'address' },
        { name: 'tmStatus', type: 'uint256' }, { name: 'tmFunds', type: 'uint256' },
        { name: 'tmMaxFunds', type: 'uint256' }, { name: 'tmOffers', type: 'uint256' },
        { name: 'tmMaxOffers', type: 'uint256' }, { name: 'tmLastPrice', type: 'uint256' },
        { name: 'tmLaunchTime', type: 'uint256' }, { name: 'tmTradingFeeRate', type: 'uint256' },
        { name: 'tmLiquidityAdded', type: 'bool' }, { name: 'flapStatus', type: 'uint8' },
        { name: 'flapReserve', type: 'uint256' }, { name: 'flapCirculatingSupply', type: 'uint256' },
        { name: 'flapPrice', type: 'uint256' }, { name: 'flapTokenVersion', type: 'uint8' },
        { name: 'flapQuoteToken', type: 'address' }, { name: 'flapNativeSwapEnabled', type: 'bool' },
        { name: 'flapTaxRate', type: 'uint256' }, { name: 'flapPool', type: 'address' },
        { name: 'flapProgress', type: 'uint256' }, { name: 'pair', type: 'address' },
        { name: 'quoteToken', type: 'address' }, { name: 'pairReserve0', type: 'uint256' },
        { name: 'pairReserve1', type: 'uint256' }, { name: 'hasLiquidity', type: 'bool' },
        { name: 'isTaxToken', type: 'bool' }, { name: 'taxFeeRate', type: 'uint256' },
      ]
    }]
  },
];
