import {
  buildSystemUserUpdate,
  filterSystemUsers,
  isProtectedPrimaryAdmin,
  SYSTEM_USER_TYPE_LABELS,
} from './systemUserMaintenance';

const users = [
  {
    id: 'admin-1',
    user_type: 'platform_admin',
    role: 'system_admin',
    email: 'primary@example.com',
    full_name: 'Primary Administrator',
    is_active: true,
    protected: true,
    can_edit_status: false,
    organization: null,
    company: null,
  },
  {
    id: 'customer-1',
    user_type: 'tenant_user',
    role: 'customer',
    email: 'buyer@example.com',
    full_name: 'Buyer One',
    is_active: false,
    organization: { id: 'org-1', name: 'Copperbelt Health' },
    company: null,
  },
  {
    id: 'supplier-1',
    user_type: 'supplier_user',
    role: 'supplier',
    email: 'sales@example.com',
    full_name: 'Supplier One',
    is_active: true,
    organization: null,
    company: { id: 'supplier-company-1', name: 'Lusaka Office Supplies' },
  },
];

describe('system user maintenance helpers', () => {
  test('searches identity and affiliation fields case-insensitively', () => {
    expect(filterSystemUsers(users, { search: 'COPPERBELT' })).toEqual([users[1]]);
    expect(filterSystemUsers(users, { search: 'office supplies' })).toEqual([users[2]]);
  });

  test('combines account type and status filters', () => {
    expect(filterSystemUsers(users, { type: 'tenant_user', status: 'inactive' })).toEqual([users[1]]);
    expect(filterSystemUsers(users, { type: 'supplier_user', status: 'inactive' })).toEqual([]);
  });

  test('returns an empty list for malformed input', () => {
    expect(filterSystemUsers(null, { search: 'anything' })).toEqual([]);
  });

  test('only protects the primary system administrator controls', () => {
    expect(isProtectedPrimaryAdmin(users[0])).toBe(true);
    expect(isProtectedPrimaryAdmin({ ...users[0], protected: false })).toBe(false);
    expect(isProtectedPrimaryAdmin({
      ...users[0],
      protected: false,
      role: 'system_admin',
    })).toBe(false);
    expect(isProtectedPrimaryAdmin(users[1])).toBe(false);
  });

  test('provides clear account type labels', () => {
    expect(SYSTEM_USER_TYPE_LABELS.supplier_user).toBe('Supplier user');
  });

  test('omits protected fields for the primary administrator', () => {
    expect(buildSystemUserUpdate(users[0], {
      full_name: ' Updated Primary ',
      email: 'changed@example.com',
      is_active: false,
    })).toEqual({ full_name: 'Updated Primary' });
  });

  test('omits status for the current admin while allowing identity updates', () => {
    const currentAdmin = {
      ...users[0],
      protected: false,
      can_edit_status: false,
      role: 'business_admin',
    };
    expect(buildSystemUserUpdate(currentAdmin, {
      full_name: ' Current Admin ',
      email: 'CURRENT@EXAMPLE.COM ',
      is_active: false,
    })).toEqual({
      full_name: 'Current Admin',
      email: 'current@example.com',
    });
  });
});
