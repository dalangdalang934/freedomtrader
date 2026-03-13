import assert from 'node:assert/strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...classes) => classes.forEach(cls => set.add(cls)),
    remove: (...classes) => classes.forEach(cls => set.delete(cls)),
    toggle: (cls, force) => {
      if (force === undefined) {
        if (set.has(cls)) {
          set.delete(cls);
          return false;
        }
        set.add(cls);
        return true;
      }
      if (force) set.add(cls);
      else set.delete(cls);
      return !!force;
    },
    contains: cls => set.has(cls),
    toString: () => [...set].join(' '),
  };
}

function createMockElement(id, options = {}) {
  const element = {
    id,
    value: options.value || '',
    textContent: options.textContent || '',
    innerHTML: options.innerHTML || '',
    className: options.className || '',
    style: { display: options.display || '' },
    dataset: { ...(options.dataset || {}) },
    classList: makeClassList(options.classes || []),
    oninput: null,
    onchange: null,
    addEventListener(type, handler) {
      this[`on${type}`] = handler;
    },
    closest(selector) {
      if (selector === 'button') return this;
      return null;
    },
  };
  return element;
}

class DocumentMock {
  constructor() {
    this.readyState = 'complete';
    this.elements = new Map();
    this.listeners = new Map();
  }

  reset() {
    this.elements.clear();
    this.listeners.clear();
  }

  register(element) {
    this.elements.set(element.id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  querySelector(selector) {
    if (selector === '.bal-label') return this.elements.get('balLabel') || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '.slip-btn') {
      return [...this.elements.values()].filter(el => el.classList.contains('slip-btn'));
    }
    return [];
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  createElement() {
    const node = { innerHTML: '', _textContent: '' };
    Object.defineProperty(node, 'textContent', {
      get() {
        return this._textContent;
      },
      set(value) {
        this._textContent = String(value);
        this.innerHTML = escapeHtml(this._textContent);
      },
    });
    return node;
  }
}

const documentMock = new DocumentMock();
const storageWrites = [];

globalThis.document = documentMock;
globalThis.window = globalThis;
globalThis.location = { href: '' };
globalThis.chrome = {
  storage: {
    local: {
      set(payload) {
        storageWrites.push(payload);
        return Promise.resolve();
      },
      async get() {
        return {};
      },
    },
  },
  runtime: {
    onMessage: {
      addListener() {},
    },
  },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBaseDom() {
  documentMock.reset();

  const baseIds = [
    'amount', 'slippage', 'tokenAddress', 'priceInfo', 'estimatedPrice', 'minOutput',
    'warningBox', 'statusBar', 'toast', 'tabBuy', 'tabSell', 'tradeBtn', 'amountLabel',
    'buyQuickRow', 'sellPercentRow', 'gasPriceInput', 'jitoTipInput', 'bnbBalance',
    'walletCount', 'balanceDetails', 'balanceHint', 'selectedCount', 'walletSelector',
    'chainBsc', 'chainSol', 'gasLabel', 'jitoCol',
  ];

  baseIds.forEach(id => documentMock.register(createMockElement(id)));
  documentMock.register(createMockElement('balLabel'));

  documentMock.getElementById('slippage').value = '15';
  documentMock.getElementById('gasPriceInput').value = '3';
  documentMock.getElementById('jitoTipInput').value = '0.0001';

  const slipPreset = createMockElement('slipPreset25', {
    classes: ['slip-btn', 'slippage-btn'],
    dataset: { slip: '25' },
  });
  documentMock.register(slipPreset);

  return {
    amount: documentMock.getElementById('amount'),
    slippage: documentMock.getElementById('slippage'),
    estimatedPrice: documentMock.getElementById('estimatedPrice'),
    minOutput: documentMock.getElementById('minOutput'),
    bnbBalance: documentMock.getElementById('bnbBalance'),
    walletCount: documentMock.getElementById('walletCount'),
    balanceDetails: documentMock.getElementById('balanceDetails'),
    balanceHint: documentMock.getElementById('balanceHint'),
    slipPreset,
  };
}

function resetWrites() {
  storageWrites.length = 0;
}

const { state } = await import('../src/state.js');
const utils = await import('../src/utils.js');
const ui = await import('../src/ui.js');
const { loadBalances } = await import('../src/wallet.js');
const { ROUTE } = await import('../src/constants.js');

function resetState() {
  state.config = {};
  state.tradeMode = 'buy';
  state.currentChain = 'bsc';
  state.amountDrafts = {
    bsc: { buy: '', sell: '' },
    sol: { buy: '', sell: '' },
  };
  state.tokenInfo = { decimals: 18, symbol: '', balance: 0n };
  state.lpInfo = { hasLP: false, isInternal: false, reserveBNB: 0n, reserveToken: 0n };
  state.tokenBalances = new Map();
  state.publicClient = null;
  state.wallets = [];
  state.activeWalletIds = [];
  state.walletClients = new Map();
  state.walletBalances = new Map();
  state.approvedTokens = new Set();
  state.solConfig = { slippage: 25, buyAmount: 0.1, priorityFee: 100000, jitoTip: 100000, rpcUrl: '' };
  state.solWallets = [];
  state.solActiveWalletIds = [];
  state.solAddresses = new Map();
  state.solWalletBalances = new Map();
}

async function testPureAmountHelpers() {
  assert.equal(utils.sanitizeAmountInput('0.'), '0.');
  assert.equal(utils.sanitizeAmountInput('12.3456', 2), '12.34');
  assert.equal(utils.normalizeAmount('001.2300', 18), '1.23');
  assert.equal(utils.getTradeAmountDecimals('bsc', 'buy', 18), 18);
  assert.equal(utils.getTradeAmountDecimals('sol', 'sell', 6), 2);
}

async function testModeDraftIsolation() {
  const { amount } = createBaseDom();
  resetState();
  ui.setupEvents();

  amount.value = '0.123456';
  amount.oninput();
  assert.equal(amount.value, '0.123456');

  ui.switchMode('sell');
  assert.equal(amount.value, '');

  amount.value = '12.3456';
  amount.oninput();
  assert.equal(amount.value, '12.34');

  ui.switchMode('buy');
  assert.equal(amount.value, '0.123456');

  const writes = storageWrites.filter(entry => 'buyAmount' in entry);
  assert.ok(writes.some(entry => entry.buyAmount === '0.123456'));
}

async function testSolSlippagePresetPersistence() {
  const { slipPreset, slippage } = createBaseDom();
  resetState();
  resetWrites();
  state.currentChain = 'sol';
  ui.setupEvents();

  await documentMock.listeners.get('click')({
    preventDefault() {},
    target: slipPreset,
  });

  assert.equal(slippage.value, '25');
  assert.deepEqual(storageWrites.at(-1), { solSlippage: '25' });
}

async function testBalanceRefreshInvalidatesOldRequests() {
  const { bnbBalance, walletCount, balanceDetails, balanceHint } = createBaseDom();
  resetState();
  resetWrites();

  state.currentChain = 'bsc';
  state.config.rpcUrl = 'https://bsc-rpc.test';
  state.wallets = [
    { id: 'a', name: 'Wallet A' },
    { id: 'b', name: 'Wallet B' },
  ];
  state.activeWalletIds = ['a'];
  state.walletClients = new Map([
    ['a', { address: '0xaaa' }],
    ['b', { address: '0xbbb' }],
  ]);

  const pending = new Map();
  state.publicClient = {
    getBalance({ address }) {
      return new Promise(resolve => pending.set(address, resolve));
    },
  };

  const first = loadBalances();
  state.activeWalletIds = ['b'];
  const second = loadBalances();

  pending.get('0xaaa')(1_000000000000000000n);
  await sleep(0);

  pending.get('0xbbb')(2_000000000000000000n);
  await Promise.all([first, second]);

  assert.equal(bnbBalance.textContent, '2.0000');
  assert.equal(walletCount.textContent, '1/2');
  assert.match(balanceDetails.innerHTML, /Wallet B/);
  assert.doesNotMatch(balanceDetails.innerHTML, /Wallet A/);
  assert.equal(balanceHint.textContent, '1 个钱包');
}

async function testPriceUpdaterDropsStaleAsyncQuote() {
  const { amount, slippage, estimatedPrice, minOutput } = createBaseDom();
  resetState();
  resetWrites();
  ui.setupEvents();

  state.currentChain = 'bsc';
  state.tradeMode = 'buy';
  state.activeWalletIds = ['a'];
  state.walletClients = new Map([['a', { address: '0xaaa' }]]);
  state.tokenInfo = { decimals: 18, symbol: 'TST', balance: 0n, address: '0xtoken' };
  state.lpInfo = {
    hasLP: true,
    reserveBNB: 100n * 10n ** 18n,
    reserveToken: 1000n * 10n ** 18n,
    routeSource: ROUTE.FLAP_BONDING,
  };

  const resolvers = [];
  state.publicClient = {
    readContract() {
      return new Promise(resolve => resolvers.push(resolve));
    },
  };

  amount.value = '1';
  slippage.value = '15';
  ui.updatePrice();
  await sleep(180);

  amount.value = '2';
  ui.updatePrice();
  await sleep(180);

  resolvers[0](111n * 10n ** 18n);
  await sleep(0);
  assert.equal(estimatedPrice.textContent, '');
  assert.equal(minOutput.textContent, '');

  resolvers[1](222n * 10n ** 18n);
  await sleep(0);
  assert.equal(estimatedPrice.textContent, '≈ 222.0000 TST × 1');
  assert.equal(minOutput.textContent, '≥ 188.7000 TST');
}

const tests = [
  ['pure-amount-helpers', testPureAmountHelpers],
  ['mode-draft-isolation', testModeDraftIsolation],
  ['sol-slippage-preset-persistence', testSolSlippagePresetPersistence],
  ['balance-refresh-invalidates-old-requests', testBalanceRefreshInvalidatesOldRequests],
  ['price-updater-drops-stale-async-quote', testPriceUpdaterDropsStaleAsyncQuote],
];

let passed = 0;
for (const [name, testFn] of tests) {
  try {
    await testFn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`All regression checks passed (${passed}/${tests.length})`);
}
