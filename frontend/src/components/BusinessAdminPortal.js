import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Menu, Drawer, Button } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  ShopOutlined,
  DollarOutlined,
  UserOutlined,
  BankOutlined,
  MenuOutlined,
  ArrowRightOutlined,
  CustomerServiceOutlined,
} from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import BusinessAdminDashboard from './BusinessAdminDashboard';
import BidManagement from './BidManagement';
import CreateBidWizard from './CreateBidWizard';
import BidDetail from './BidDetail';
import BidEvaluation from './BidEvaluation';
import SupplierVerification from './SupplierVerification';
import FinancialLedger from './FinancialLedger';
import InvoiceManagement from './InvoiceManagement';
import OrdersList from './OrdersList';
import UserManagement from './UserManagement';
import OrganizationManagement from './OrganizationManagement';
import AdminSupportInbox from './AdminSupportInbox';

const { Sider, Content } = Layout;

export default function BusinessAdminPortal() {
  const { user } = useAuth();
  const { appearance } = useTheme();
  const role = user?.role;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const navigate = useNavigate();
  const location = useLocation();

  const effectiveTheme = useMemo(() => {
    if (appearance === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    }
    return appearance || 'light';
  }, [appearance]);

  // Track viewport size for responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setMobileDrawerOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const menuItems = useMemo(() => {
    const items = [];
    if (role === 'business_admin') {
      items.push(
      { key: '/admin', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: '/admin/bids', icon: <FileTextOutlined />, label: 'Bids' },
      { key: '/admin/bids/new', icon: <PlusOutlined />, label: 'Create Bid' },
      { key: '/admin/orders', icon: <CheckCircleOutlined />, label: 'Orders' },
      { key: '/admin/invoices', icon: <FileTextOutlined />, label: 'Invoices' },
      { key: '/admin/verification', icon: <ShopOutlined />, label: 'Supplier Verification' },
      { key: '/admin/ledger', icon: <DollarOutlined />, label: 'Financial Ledger' },
      { key: '/admin/users', icon: <UserOutlined />, label: 'User Accounts' },
      { key: '/admin/tenants', icon: <BankOutlined />, label: 'Organizations' },
      { key: '/admin/support', icon: <CustomerServiceOutlined />, label: 'Customer Care' },
      );
    }
    return items;
  }, [role]);

  useEffect(() => {
    if (location.pathname === '/admin' && menuItems.length > 0) {
      navigate(menuItems[0].key, { replace: true });
    }
  }, [location.pathname, menuItems, navigate]);

  // Close mobile drawer on navigation
  const handleMenuClick = ({ key }) => {
    navigate(key);
    if (isMobile) setMobileDrawerOpen(false);
  };

  const renderContent = () => {
    const path = location.pathname;
    if (path === '/admin' || path === '/admin/') {
      return <BusinessAdminDashboard />;
    }
    if (path === '/admin/bids') return <BidManagement />;
    if (path === '/admin/bids/new') return <CreateBidWizard />;
    // /admin/bids/:id/evaluate — must check before the generic :id route
    if (path.startsWith('/admin/bids/') && path.endsWith('/evaluate')) return <BidEvaluation />;
    if (path.startsWith('/admin/bids/') && path.split('/').length === 4) return <BidDetail />;
    if (path === '/admin/orders') return <OrdersList />;
    if (path === '/admin/invoices') return <InvoiceManagement />;
    if (path === '/admin/verification') return <SupplierVerification />;
    if (path === '/admin/ledger') return <FinancialLedger />;
    if (path === '/admin/users') return <UserManagement />;
    if (path === '/admin/tenants') return <OrganizationManagement />;
    if (path === '/admin/support') return <AdminSupportInbox />;
    return <BusinessAdminDashboard />;
  };

  if (!user) {
    return <div style={{ padding: 24, textAlign: 'center' }}>Loading admin...</div>;
  }

  if (role !== 'business_admin') {
    return <div style={{ padding: 24, textAlign: 'center' }}>Business admin access is required.</div>;
  }

  const selectedKey = [...menuItems]
    .sort((a, b) => b.key.length - a.key.length)
    .find(item => (
      item.key === location.pathname ||
      (item.key !== '/admin' && location.pathname.startsWith(`${item.key}/`))
    ))?.key || '/admin';

  const sidebarMenu = (
    <div className="admin-navigation">
      <div className="admin-navigation-heading">
        <span>Manage</span>
        {!collapsed && <small>Procurement operations</small>}
      </div>
      <Menu
        className="admin-navigation-menu"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={handleMenuClick}
        theme={effectiveTheme}
      />
      {!collapsed && (
        <Button className="admin-navigation-cta" type="primary" icon={<PlusOutlined />} onClick={() => handleMenuClick({ key: '/admin/bids/new' })}>
          Start a new bid <ArrowRightOutlined />
        </Button>
      )}
    </div>
  );

  return (
    <Layout className="admin-portal-layout" hasSider>
      {/* Desktop Sider */}
      {!isMobile && (
        <Sider className="admin-sider" collapsible collapsed={collapsed} onCollapse={setCollapsed} theme={effectiveTheme} width={248}>
          {sidebarMenu}
        </Sider>
      )}

      {/* Mobile hamburger button */}
      {isMobile && (
        <div className="admin-mobile-navigation">
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open navigation menu"
          >Menu <span className="admin-mobile-current-page">· {menuItems.find(item => item.key === selectedKey)?.label}</span></Button>
        </div>
      )}

      {/* Mobile Drawer */}
      <Drawer
        title="Admin Panel"
        placement="left"
        onClose={() => setMobileDrawerOpen(false)}
        open={mobileDrawerOpen}
        styles={{ body: { padding: 0 } }}
        width={260}
      >
        {sidebarMenu}
      </Drawer>

      {/* Main Content */}
      <Content className={`admin-content${isMobile ? ' admin-content--mobile' : ''}`}>
        {renderContent()}
      </Content>
    </Layout>
  );
}
