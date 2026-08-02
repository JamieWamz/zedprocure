import { resolvePaymentPollingState } from './paymentPollingState';

describe('payment modal state transitions', () => {
  test('stays in the loading state while the provider is pending', () => {
    expect(resolvePaymentPollingState('pending', 2)).toEqual({ terminal: false, step: 1, finalStatus: null });
  });

  test('moves to success when the gateway confirms', () => {
    expect(resolvePaymentPollingState('successful', 2)).toEqual({ terminal: true, step: 2, finalStatus: 'successful' });
  });

  test('moves to the retryable error state on a provider failure', () => {
    expect(resolvePaymentPollingState('failed', 2)).toEqual({ terminal: true, step: 2, finalStatus: 'failed' });
  });

  test('uses a safe pending fallback after bounded polling', () => {
    expect(resolvePaymentPollingState('pending', 30)).toEqual({ terminal: true, step: 2, finalStatus: 'timeout' });
  });
});
