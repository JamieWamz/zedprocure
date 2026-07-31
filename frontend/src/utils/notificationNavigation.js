function metadataOf(notification) {
  if (!notification?.metadata) return {};
  if (typeof notification.metadata === 'object') return notification.metadata;
  try {
    return JSON.parse(notification.metadata);
  } catch {
    return {};
  }
}

function idFromLink(link, resource) {
  if (!link) return null;
  const match = String(link).match(new RegExp(`/${resource}/([^/?#]+)`));
  return match?.[1] || null;
}

export function getNotificationDestination(notification, user) {
  const metadata = metadataOf(notification);
  const role = user?.role || user?.user_type;
  const rawLink = notification?.link || '';
  const bidId = metadata.bid_id || idFromLink(rawLink, 'bids');
  const orderId = metadata.order_id || idFromLink(rawLink, 'orders');
  const invoiceId = metadata.invoice_id || idFromLink(rawLink, 'invoices');

  if (notification?.type === 'verification_update') return '/supplier/verification';

  if (notification?.type === 'support_issue') {
    const issueId = metadata.support_issue_id;
    if (role === 'system_admin') return `/system-health?tab=support${issueId ? `&focus=${encodeURIComponent(issueId)}` : ''}`;
    return `/admin/support${issueId ? `?focus=${encodeURIComponent(issueId)}` : ''}`;
  }

  if (notification?.type === 'customer_request') {
    const focus = metadata.request_id ? `&focus=${encodeURIComponent(metadata.request_id)}` : '';
    return `/admin?section=procurement-requests${focus}`;
  }

  if (notification?.type === 'customer_requirement' && bidId) {
    return `/admin/bids/${encodeURIComponent(bidId)}#customer-requirements`;
  }

  if (['new_bid', 'bid_invitation', 'deadline_reminder_24h', 'deadline_reminder_1h'].includes(notification?.type) && bidId) {
    return `/supplier/bids/${encodeURIComponent(bidId)}#supplier-response`;
  }

  if (orderId || /order|delivery|escrow|award/i.test(notification?.type || '')) {
    const tab = role === 'customer' ? 'orders_escrow' : 'orders';
    const root = role === 'customer' ? '/customer' : role === 'supplier_user' ? '/supplier' : '/admin/orders';
    const focus = orderId ? `&focus=${encodeURIComponent(orderId)}` : '';
    return root.startsWith('/admin/') ? `${root}${orderId ? `?focus=${encodeURIComponent(orderId)}` : ''}` : `${root}?tab=${tab}${focus}`;
  }

  if (invoiceId || /invoice|payment/i.test(notification?.type || '')) {
    if (role === 'customer') return `/customer?tab=invoices${invoiceId ? `&focus=${encodeURIComponent(invoiceId)}` : ''}`;
    return `/admin/invoices${invoiceId ? `?focus=${encodeURIComponent(invoiceId)}` : ''}`;
  }

  // Normalize legacy generic bid links according to the signed-in workspace.
  if (bidId && /^\/bids\//.test(rawLink)) {
    if (role === 'supplier_user') return `/supplier/bids/${encodeURIComponent(bidId)}#supplier-response`;
    if (role === 'customer') return `/customer/bids/${encodeURIComponent(bidId)}`;
    return `/admin/bids/${encodeURIComponent(bidId)}`;
  }

  if (rawLink.startsWith('/')) return rawLink;
  if (role === 'supplier_user') return '/supplier';
  if (role === 'customer') return '/customer';
  return '/admin';
}

export function isActivationKey(event) {
  return event.key === 'Enter' || event.key === ' ';
}
