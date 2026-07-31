const MAX_MONEY_CENTS = 100_000_000_000;

class MonetizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MonetizationError';
    this.code = code;
  }
}

function toCents(value, field = 'amount', { allowZero = false } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(number)) {
    throw new MonetizationError('INVALID_MONEY', `${field} must be a valid monetary amount`);
  }
  const cents = Math.round(number * 100);
  if (cents < 0 || (!allowZero && cents === 0) || cents > MAX_MONEY_CENTS) {
    throw new MonetizationError('INVALID_MONEY', `${field} is outside the permitted range`);
  }
  return cents;
}

function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

function percentageFee(baseCents, percent) {
  const rate = Number(percent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new MonetizationError('INVALID_RATE', 'fee percentage must be between 0 and 100');
  }
  return Math.round((baseCents * rate) / 100);
}

function calculateTransactionPricing({
  userPrice,
  supplierPrice,
  escrowFeeType = 'percentage',
  escrowFeePercent = 0,
  escrowFeeFixed = 0,
  expressMatch = false,
  expressMatchFee = 0,
  allowSubsidized = false,
  subsidyLimit = 0,
}) {
  const userPriceCents = toCents(userPrice, 'user price');
  const supplierPriceCents = toCents(supplierPrice, 'supplier price');
  const spreadCents = userPriceCents - supplierPriceCents;
  const subsidyLimitCents = toCents(subsidyLimit, 'subsidy limit', { allowZero: true });

  if (spreadCents < 0 && (!allowSubsidized || Math.abs(spreadCents) > subsidyLimitCents)) {
    throw new MonetizationError(
      'NEGATIVE_SPREAD',
      'The buyer price does not cover the supplier quote and no sufficient subsidy is configured'
    );
  }

  let protectionFeeCents;
  if (escrowFeeType === 'fixed') {
    protectionFeeCents = toCents(escrowFeeFixed, 'buyer protection fee', { allowZero: true });
  } else if (escrowFeeType === 'percentage') {
    protectionFeeCents = percentageFee(userPriceCents, escrowFeePercent);
  } else {
    throw new MonetizationError('INVALID_FEE_TYPE', 'escrow fee type must be fixed or percentage');
  }

  const expressFeeCents = expressMatch
    ? toCents(expressMatchFee, 'express match fee', { allowZero: true })
    : 0;
  const buyerTotalCents = userPriceCents + protectionFeeCents + expressFeeCents;
  const platformRevenueCents = spreadCents + protectionFeeCents + expressFeeCents;
  const subsidyAmountCents = Math.max(0, -platformRevenueCents);
  const platformFeeCaptureCents = Math.max(0, platformRevenueCents);

  return {
    userPrice: fromCents(userPriceCents),
    supplierPrice: fromCents(supplierPriceCents),
    spread: fromCents(spreadCents),
    protectionFee: fromCents(protectionFeeCents),
    expressMatchFee: fromCents(expressFeeCents),
    buyerTotal: fromCents(buyerTotalCents),
    supplierPayout: fromCents(supplierPriceCents),
    platformRevenue: fromCents(platformRevenueCents),
    platformFeeCapture: fromCents(platformFeeCaptureCents),
    subsidyAmount: fromCents(subsidyAmountCents),
    subsidized: spreadCents < 0,
  };
}

function calculateWithdrawal({ grossAmount, feePercent = 0, fixedFee = 0 }) {
  const grossCents = toCents(grossAmount, 'withdrawal amount');
  const variableFeeCents = percentageFee(grossCents, feePercent);
  const fixedFeeCents = toCents(fixedFee, 'fixed withdrawal fee', { allowZero: true });
  const feeCents = variableFeeCents + fixedFeeCents;
  if (feeCents >= grossCents) {
    throw new MonetizationError('FEE_EXCEEDS_AMOUNT', 'Withdrawal fees must be less than the withdrawal amount');
  }
  return {
    grossAmount: fromCents(grossCents),
    processingFee: fromCents(feeCents),
    netPayout: fromCents(grossCents - feeCents),
  };
}

function buyerQuote(pricing) {
  return {
    procurementAmount: pricing.userPrice,
    buyerProtectionFee: pricing.protectionFee,
    expressMatchFee: pricing.expressMatchFee,
    totalDue: pricing.buyerTotal,
  };
}

function supplierQuote(pricing) {
  return {
    acceptedQuote: pricing.supplierPrice,
    netPayout: pricing.supplierPayout,
    payoutProcessingFee: '0.00',
  };
}

module.exports = {
  MonetizationError,
  toCents,
  fromCents,
  calculateTransactionPricing,
  calculateWithdrawal,
  buyerQuote,
  supplierQuote,
};
