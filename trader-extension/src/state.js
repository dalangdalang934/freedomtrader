export const state = {
  config: {},
  tradeMode: 'buy',
  currentChain: 'bsc',

  // shared — current chain's token/LP info (written by token-bsc or token-sol)
  tokenInfo: { decimals: 18, symbol: '', balance: 0n },
  lpInfo: { hasLP: false, isInternal: false, reserveBNB: 0n, reserveToken: 0n },
  tokenBalances: new Map(),

  // BSC
  publicClient: null,
  wallets: [],
  activeWalletIds: [],
  walletClients: new Map(),
  walletBalances: new Map(),
  approvedTokens: new Set(),

  // SOL
  solConfig: { slippage: 25, buyAmount: 0.1, priorityFee: 100000, jitoTip: 100000, rpcUrl: '' },
  solWallets: [],
  solActiveWalletIds: [],
  solAddresses: new Map(),
  solWalletBalances: new Map(),
};
