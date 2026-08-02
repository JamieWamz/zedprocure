export const SYSTEM_USER_TYPE_LABELS = {
  platform_admin: 'Platform administrator',
  tenant_user: 'Organization user',
  supplier_user: 'Supplier user',
};

export function isProtectedPrimaryAdmin(user) {
  return user?.protected === true;
}

export function buildSystemUserUpdate(user, values) {
  const protectedPrimaryAdmin = isProtectedPrimaryAdmin(user);
  const update = { full_name: values.full_name.trim() };

  if (!protectedPrimaryAdmin) update.email = values.email.trim().toLowerCase();
  if (user?.can_edit_status !== false && !protectedPrimaryAdmin) {
    update.is_active = Boolean(values.is_active);
  }

  return update;
}

export function filterSystemUsers(users, { search = '', type = 'all', status = 'all' } = {}) {
  const query = search.trim().toLowerCase();

  return (Array.isArray(users) ? users : []).filter(user => {
    const matchesType = type === 'all' || user.user_type === type;
    const matchesStatus = status === 'all'
      || (status === 'active' ? Boolean(user.is_active) : !user.is_active);
    const searchable = [
      user.full_name,
      user.email,
      user.role,
      user.organization?.name,
      user.company?.name,
    ].filter(Boolean).join(' ').toLowerCase();

    return matchesType && matchesStatus && (!query || searchable.includes(query));
  });
}
