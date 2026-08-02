export function resolvePaymentPollingState(providerStatus, attempt, maxAttempts = 30) {
  if (providerStatus === 'successful') {
    return { terminal: true, step: 2, finalStatus: 'successful' };
  }
  if (providerStatus === 'failed') {
    return { terminal: true, step: 2, finalStatus: 'failed' };
  }
  if (attempt >= maxAttempts) {
    return { terminal: true, step: 2, finalStatus: 'timeout' };
  }
  return { terminal: false, step: 1, finalStatus: null };
}
