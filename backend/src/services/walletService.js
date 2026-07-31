/**
 * Wallet Service
 * Manages in-app wallet operations: balance queries, debit/credit,
 * and auto-creation of wallets for users.
 */
const pool = require('../config/db');
const crypto = require('crypto');

/**
 * Ensure a wallet exists for the given user, creating one if needed.
 * Returns the wallet record.
 */
async function ensureWallet(userId, userType, client = pool) {
  const { rows: [existing] } = await client.query(
    'SELECT id, balance FROM wallets WHERE user_id = $1 AND user_type = $2',
    [userId, userType]
  );
  if (existing) return existing;

  // Demo balances must be explicitly enabled. Production wallets always start at zero.
  const configuredDemoBalance = process.env.DEMO_WALLET_INITIAL_BALANCE;
  const initialBalance = process.env.DEMO_MODE === 'true' && configuredDemoBalance
    ? Math.max(0, Number(configuredDemoBalance) || 0)
    : 0;
  const { rows: [wallet] } = await client.query(
    `INSERT INTO wallets (user_id, user_type, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, user_type) DO NOTHING
     RETURNING id, balance`,
    [userId, userType, initialBalance]
  );
  if (wallet) return wallet;
  const { rows: [concurrentWallet] } = await client.query(
    'SELECT id, balance FROM wallets WHERE user_id = $1 AND user_type = $2',
    [userId, userType]
  );
  if (!concurrentWallet) throw new Error('Failed to create wallet');
  return concurrentWallet;
}

/**
 * Debit a user's wallet by the given amount.
 * Must be called within an active transaction (client provided).
 * Throws if insufficient balance.
 */
async function debitWallet(walletId, amount, description, client, options = {}) {
  const amt = Number(amount);
  if (amt <= 0) throw new Error('Debit amount must be positive');

  // Lock and check balance
  const { rows: [wallet] } = await client.query(
    'SELECT balance FROM wallets WHERE id = $1 FOR UPDATE',
    [walletId]
  );
  if (!wallet) throw new Error('Wallet not found');
  if (Number(wallet.balance) < amt) throw new Error('Insufficient wallet balance');

  const balanceBefore = Number(wallet.balance);
  const balanceAfter = balanceBefore - amt;

  await client.query(
    `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, reference, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [crypto.randomUUID(), walletId, options.type || 'withdrawal', amt, balanceBefore, balanceAfter,
     options.reference || null, description]
  );
  await client.query(
    'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
    [balanceAfter, walletId]
  );

  return { balanceBefore, balanceAfter };
}

/**
 * Credit a user's wallet by the given amount.
 * Must be called within an active transaction (client provided).
 */
async function creditWallet(walletId, amount, description, client, options = {}) {
  const amt = Number(amount);
  if (amt <= 0) throw new Error('Credit amount must be positive');

  const { rows: [wallet] } = await client.query(
    'SELECT balance FROM wallets WHERE id = $1 FOR UPDATE',
    [walletId]
  );
  if (!wallet) throw new Error('Wallet not found');

  const balanceBefore = Number(wallet.balance);
  const balanceAfter = balanceBefore + amt;

  await client.query(
    `INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_before, balance_after, reference, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [crypto.randomUUID(), walletId, options.type || 'deposit', amt, balanceBefore, balanceAfter,
     options.reference || null, description]
  );
  await client.query(
    'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
    [balanceAfter, walletId]
  );

  return { balanceBefore, balanceAfter };
}

module.exports = {
  ensureWallet,
  debitWallet,
  creditWallet,
};
