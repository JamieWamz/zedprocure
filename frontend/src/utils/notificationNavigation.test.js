import { getNotificationDestination } from './notificationNavigation';

describe('notification destination resolution', () => {
  test('opens supplier bid notifications at the response action', () => {
    expect(getNotificationDestination(
      { type: 'new_bid', link: '/bids/bid-123', metadata: { bid_id: 'bid-123' } },
      { user_type: 'supplier_user' }
    )).toBe('/supplier/bids/bid-123#supplier-response');
  });

  test('opens customer requests at the focused admin section', () => {
    expect(getNotificationDestination(
      { type: 'customer_request', metadata: { request_id: 'request-7' } },
      { role: 'business_admin' }
    )).toBe('/admin?section=procurement-requests&focus=request-7');
  });

  test('routes order updates to the correct role tab', () => {
    expect(getNotificationDestination(
      { type: 'order_update', metadata: { order_id: 'order-9' } },
      { role: 'customer' }
    )).toBe('/customer?tab=orders_escrow&focus=order-9');
  });

  test('normalizes old generic bid links for admins', () => {
    expect(getNotificationDestination(
      { type: 'legacy', link: '/bids/bid-5' },
      { role: 'business_admin' }
    )).toBe('/admin/bids/bid-5');
  });
});
