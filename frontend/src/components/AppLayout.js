import React, { useMemo } from 'react';
import { Layout, Button, Typography, Select, Tooltip, Breadcrumb, Avatar, Tag } from 'antd';
import {
  LogoutOutlined,
  ArrowLeftOutlined,
  BankOutlined,
  BulbOutlined,
  HomeOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const { Header, Content } = Layout;
const { Text } = Typography;

const ROLE_LABELS = {
  business_admin: 'Business admin',
  system_admin: 'System admin',
  customer: 'Customer',
  supplier_user: 'Supplier',
};

function routeContext(pathname, dashboardRoute) {
  if (pathname === '/system-health') return { title: 'System health', section: 'Operations', backPath: null };
  if (pathname === '/admin') return { title: 'Business dashboard', section: 'Administration', backPath: null };
  if (pathname === '/admin/bids/new') return { title: 'Create a bid', section: 'Bids', backPath: '/admin/bids' };
  if (/^\/admin\/bids\/[^/]+\/evaluate$/.test(pathname)) return { title: 'Evaluate and award', section: 'Bids', backPath: pathname.replace('/evaluate', '') };
  if (/^\/admin\/bids\/[^/]+$/.test(pathname)) return { title: 'Bid details', section: 'Bids', backPath: '/admin/bids' };
  if (pathname === '/admin/bids') return { title: 'Procurement bids', section: 'Administration', backPath: null };
  if (pathname === '/admin/orders') return { title: 'Orders', section: 'Administration', backPath: null };
  if (pathname === '/admin/invoices') return { title: 'Invoices', section: 'Finance', backPath: null };
  if (pathname === '/admin/ledger') return { title: 'Financial ledger', section: 'Finance', backPath: null };
  if (pathname === '/admin/verification') return { title: 'Supplier verification', section: 'Suppliers', backPath: null };
  if (pathname === '/admin/users') return { title: 'User accounts', section: 'Administration', backPath: null };
  if (pathname === '/admin/tenants') return { title: 'Organizations', section: 'Administration', backPath: null };
  if (/^\/supplier\/bids\/[^/]+$/.test(pathname)) return { title: 'Bid opportunity', section: 'Supplier workspace', backPath: '/supplier' };
  if (pathname === '/supplier/verification') return { title: 'Verification', section: 'Supplier workspace', backPath: '/supplier' };
  if (pathname.startsWith('/supplier')) return { title: 'Supplier workspace', section: 'Home', backPath: null };
  if (/^\/customer\/bids\/[^/]+$/.test(pathname)) return { title: 'Bid details', section: 'Customer workspace', backPath: '/customer' };
  if (pathname.startsWith('/customer')) return { title: 'Customer workspace', section: 'Home', backPath: null };
  return { title: 'Procurement portal', section: 'Workspace', backPath: dashboardRoute || null };
}

export default function AppLayout({ children, showBack = false }) {
  const { logout, user, dashboardRoute, activeTenantId, setActiveTenantId, tenants } = useAuth();
  const { appearance, setAppearance } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const context = useMemo(
    () => routeContext(location.pathname, dashboardRoute),
    [location.pathname, dashboardRoute]
  );

  const workspaceHome = dashboardRoute || '/login';
  const showOrgPicker = user && ['business_admin', 'system_admin'].includes(user.role) && tenants.length > 0;
  const initials = (user?.email || 'User')
    .split('@')[0]
    .split(/[._-]/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Layout className="app-bg app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header className="app-layout-header" role="banner">
        <Link className="app-brand" to={workspaceHome} aria-label="Freshstart Procurement workspace home">
          <span className="app-brand-mark"><SafetyCertificateOutlined /></span>
          <span className="app-brand-copy">
            <strong>Freshstart</strong>
            <small>Procurement</small>
          </span>
        </Link>

        <div className="app-layout-header-right">
          {showOrgPicker && (
            <Tooltip title="Change the organization you are managing">
              <Select
                className="header-org-picker"
                value={activeTenantId}
                onChange={setActiveTenantId}
                placeholder="Select organization"
                aria-label="Current organization"
                suffixIcon={<BankOutlined />}
                options={tenants.map(tenant => ({ value: tenant.id, label: tenant.name }))}
              />
            </Tooltip>
          )}
          <Tooltip title="Choose light, dark, or system appearance">
            <Select
              className="header-appearance-select"
              aria-label="Appearance"
              value={appearance}
              onChange={setAppearance}
              suffixIcon={<BulbOutlined />}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Tooltip>
          <div className="app-user" aria-label={`Signed in as ${user?.email || 'User'}`}>
            <Avatar size={34}>{initials}</Avatar>
            <span className="app-user-copy">
              <Text ellipsis>{user?.email || 'User'}</Text>
              <Tag bordered={false}>{ROLE_LABELS[user?.role] || ROLE_LABELS[user?.user_type] || 'Member'}</Tag>
            </span>
          </div>
          <Tooltip title="Sign out">
            <Button className="logout-button" type="text" icon={<LogoutOutlined />} onClick={handleLogout} aria-label="Sign out" />
          </Tooltip>
        </div>
      </Header>

      <div className="app-context-bar" aria-label="Page location">
        <div className="app-context-inner">
          <div className="app-context-navigation">
            {(showBack || context.backPath) && (
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate(context.backPath || -1)}
                aria-label={`Back from ${context.title}`}
              >
                Back
              </Button>
            )}
            <Breadcrumb
              items={[
                { title: <Link to={workspaceHome}><HomeOutlined /> Workspace</Link> },
                ...(context.section !== 'Home' ? [{ title: context.section }] : []),
                { title: context.title },
              ]}
            />
          </div>
          <Text className="app-context-title" strong>{context.title}</Text>
        </div>
      </div>

      <Content id="main-content" className="content-wrapper" role="main" tabIndex="-1">
        {children}
      </Content>
    </Layout>
  );
}
