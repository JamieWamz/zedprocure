import { nextPaymentResult } from './paymentFlow';

describe('payment modal state transitions', () => {
  test('stays in the loading state while the provider is pending', () => {
    expect(nextPaymentResult('pending', 2)).toEqual({ terminal: false, step: 1, finalStatus: null });
  });

  test('moves to success when the gateway confirms', () => {
    expect(nextPaymentResult('successful', 2)).toEqual({ terminal: true, step: 2, finalStatus: 'successful' });
  });

  test('moves to the retryable error state on a provider failure', () => {
    expect(nextPaymentResult('failed', 2)).toEqual({ terminal: true, step: 2, finalStatus: 'failed' });
  });

  test('uses a safe pending fallback after bounded polling', () => {
    expect(nextPaymentResult('pending', 30)).toEqual({ terminal: true, step: 2, finalStatus: 'timeout' });
  });
});
