const {
  calculateTransactionPricing,
  calculateWithdrawal,
  buyerQuote,
  supplierQuote,
} = require('../services/monetizationService');

describe('monetization engine', () => {
  test('calculates spread, protection, express, buyer total, and supplier payout in cents', () => {
    const pricing = calculateTransactionPricing({
      userPrice: '1000.05',
      supplierPrice: '800.03',
      escrowFeeType: 'percentage',
      escrowFeePercent: '2.5',
      expressMatch: true,
      expressMatchFee: '75.00',
    });
    expect(pricing).toMatchObject({
      userPrice: '1000.05',
      supplierPrice: '800.03',
      spread: '200.02',
      protectionFee: '25.00',
      expressMatchFee: '75.00',
      buyerTotal: '1100.05',
      supplierPayout: '800.03',
      platformRevenue: '300.02',
      subsidized: false,
    });
  });

  test('blocks a negative spread unless a bounded subsidy is enabled', () => {
    expect(() => calculateTransactionPricing({ userPrice: 99, supplierPrice: 100 }))
      .toThrow('does not cover the supplier quote');
    expect(calculateTransactionPricing({
      userPrice: 99,
      supplierPrice: 100,
      allowSubsidized: true,
      subsidyLimit: 1,
    }).subsidized).toBe(true);
    expect(() => calculateTransactionPricing({
      userPrice: 98.99,
      supplierPrice: 100,
      allowSubsidized: true,
      subsidyLimit: 1,
    })).toThrow('no sufficient subsidy');
  });

  test('reserves a platform top-up when buyer checkout cannot cover supplier payout', () => {
    const pricing = calculateTransactionPricing({
      userPrice: 99,
      supplierPrice: 100,
      allowSubsidized: true,
      subsidyLimit: 1,
    });
    expect(pricing).toMatchObject({
      buyerTotal: '99.00',
      supplierPayout: '100.00',
      platformRevenue: '-1.00',
      platformFeeCapture: '0.00',
      subsidyAmount: '1.00',
    });
  });

  test('does not expose the internal spread in buyer or supplier projections', () => {
    const pricing = calculateTransactionPricing({ userPrice: 100, supplierPrice: 80 });
    expect(buyerQuote(pricing)).not.toHaveProperty('spread');
    expect(supplierQuote(pricing)).not.toHaveProperty('spread');
  });

  test('calculates withdrawal processing fee and rejects fee-only payouts', () => {
    expect(calculateWithdrawal({ grossAmount: 1000, feePercent: 1.5, fixedFee: 5 }))
      .toEqual({ grossAmount: '1000.00', processingFee: '20.00', netPayout: '980.00' });
    expect(() => calculateWithdrawal({ grossAmount: 5, fixedFee: 5 }))
      .toThrow('must be less than');
  });
});
