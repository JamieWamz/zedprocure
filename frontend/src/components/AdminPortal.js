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
} from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import BusinessAdminDashboard from './BusinessAdminDashboard';
import TenantBidsList from './TenantBidsList';
import CreateBidWizard from './CreateBidWizard';
import BidDetail from './BidDetail';
import SupplierVerification from './SupplierVerification';
import FinancialLedger from './FinancialLedger';
import FinanceInvoices from './FinanceInvoices';
import OrdersList from './OrdersList';
import UserManagement from './UserManagement';
import TenantManagement from './TenantManagement';

const { Sider, Content } = Layout;

export default function AdminPortal() {
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
    if (path === '/admin/bids') return <TenantBidsList />;
    if (path === '/admin/bids/new') return <CreateBidWizard />;
    if (path.startsWith('/admin/bids/') && path.split('/').length === 4) return <BidDetail />;
    if (path === '/admin/orders') return <OrdersList />;
    if (path === '/admin/invoices') return <FinanceInvoices />;
    if (path === '/admin/verification') return <SupplierVerification />;
    if (path === '/admin/ledger') return <FinancialLedger />;
    if (path === '/admin/users') return <UserManagement />;
    if (path === '/admin/tenants') return <TenantManagement />;
    return <BusinessAdminDashboard />;
  };

  if (!user) {
    return <div style={{ padding: 24, textAlign: 'center' }}>Loading admin...</div>;
  }

  if (role !== 'business_admin') {
    return <div style={{ padding: 24, textAlign: 'center' }}>Business admin access is required.</div>;
  }

  const selectedKey = menuItems.find(item => (
    item.key === location.pathname ||
    (item.key !== '/admin' && location.pathname.startsWith(`${item.key}/`))
  ))?.key || '/admin';

  const sidebarMenu = (
    <>
      <div style={{ height: 32, margin: 16, background: 'rgba(128, 128, 128, 0.1)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
        Admin Panel
      </div>
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={handleMenuClick}
        theme={effectiveTheme}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }} hasSider>
      {/* Desktop Sider */}
      {!isMobile && (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme={effectiveTheme} width={220}>
          {sidebarMenu}
        </Sider>
      )}

      {/* Mobile hamburger button */}
      {isMobile && (
        <div style={{
          position: 'fixed',
          top: 64,
          left: 0,
          zIndex: 100,
          background: '#001529',
          borderBottomRightRadius: 8,
          padding: '4px 8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileDrawerOpen(true)}
            style={{ color: '#fff', fontSize: 18 }}
            aria-label="Open navigation menu"
          />
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
      <Content style={{ 
        padding: isMobile ? '12px' : '24px', 
        paddingLeft: isMobile ? '52px' : '24px',
        background: 'transparent', 
        minHeight: 280 
      }}>
        {renderContent()}
      </Content>
    </Layout>
  );
}