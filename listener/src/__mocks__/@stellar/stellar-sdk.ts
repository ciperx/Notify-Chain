/**
 * Manual mock for @stellar/stellar-sdk.
 * Used by Jest (via moduleNameMapper) because the real package is not a
 * dependency of this package.
 *
 * The mock previously exposed `rpc`, `Contract`, `Keypair`, `Account` and
 * `Networks` only. Production code and tests also construct and inspect
 * `xdr.ScVal` values (topic entries, event values) and call `scValToNative`, so
 * without an `xdr` export every suite that builds an event threw
 * `Cannot read properties of undefined (reading 'ScVal')` before running.
 *
 * Fidelity note: instead of the real XDR enum objects, a ScVal's `switch()`
 * returns a plain tag string, and `ScValType.scvX()` returns the same string, so
 * the `switch (val.switch()) case xdr.ScValType.scvX():` dispatch used
 * throughout this codebase compares equal. This is a test double: it models the
 * dispatch contract, not the binary encoding.
 */

// ---------------------------------------------------------------------------
// Minimal xdr.ScVal stub
// Supports the ScVal types used in tests (scvSymbol, scvString, scvU32).
//
// The real SDK returns singleton objects from ScValType.scvSymbol() /
// ScValType.scvString() so that switch-case comparisons via `===` work.
// This mock replicates that using frozen singleton constants.
// ---------------------------------------------------------------------------

const SYMBOL_TYPE = Object.freeze({ name: 'scvSymbol' });
const STRING_TYPE = Object.freeze({ name: 'scvString' });
const U32_TYPE    = Object.freeze({ name: 'scvU32' });

type ScValTypeSingleton = typeof SYMBOL_TYPE | typeof STRING_TYPE | typeof U32_TYPE;

interface MockScVal {
  _type: ScValTypeSingleton;
  _value: string | number;
  switch: () => ScValTypeSingleton;
  sym: () => { toString: () => string };
  str: () => { toString: () => string };
  toXDR: (format: string) => string;
}

function makeScVal(type: ScValTypeSingleton, value: string | number): MockScVal {
  return {
    _type: type,
    _value: value,
    switch: () => type,
    sym: () => ({ toString: () => String(value) }),
    str: () => ({ toString: () => String(value) }),
    toXDR: (_fmt: string) => Buffer.from(String(value)).toString('base64'),
  };
}

export const xdr = {
  ScVal: {
    scvSymbol: (sym: string) => makeScVal(SYMBOL_TYPE, sym),
    scvString: (str: string) => makeScVal(STRING_TYPE, str),
    scvU32: (n: number) => makeScVal(U32_TYPE, n),
  },
  /**
   * ScValType singletons — same references as the constants above so that
   * `switch (val.switch()) { case xdr.ScValType.scvSymbol(): ... }` works.
   */
  ScValType: {
    scvSymbol: () => SYMBOL_TYPE,
    scvString: () => STRING_TYPE,
    scvU32:    () => U32_TYPE,
  },
};

/**
 * Converts a mock ScVal to a native JS value for use in formatScVal.
 */
export function scValToNative(val: any): any {
  if (val && val._type) {
    if (val._type === SYMBOL_TYPE || val._type === STRING_TYPE) {
      return String(val._value);
    }
    if (val._type === U32_TYPE) {
      return Number(val._value);
    }
  }
  throw new Error('scValToNative: unknown type');
}

export const rpc = {
  Server: jest.fn().mockImplementation(() => ({
    getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    getEvents: jest.fn().mockResolvedValue({ events: [] }),
  })),
};

export const Contract = jest.fn().mockImplementation(() => ({
  call: jest.fn(),
}));

export const Keypair = {
  random: jest.fn().mockReturnValue({
    publicKey: jest.fn().mockReturnValue('GABC1234'),
    secret: jest.fn().mockReturnValue('SECRET'),
  }),
};

export const Account = jest.fn().mockImplementation((publicKey: string, sequence: string) => ({
  publicKey: () => publicKey,
  sequence,
}));

export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  MAINNET: 'Public Global Stellar Network ; September 2015',
};

export default {
  rpc,
  xdr,
  scValToNative,
  Contract,
  Keypair,
  Account,
  Networks,
};

export const BASE_FEE = '100';

export const TransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({ toXDR: jest.fn() }),
}));
