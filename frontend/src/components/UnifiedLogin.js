import React, { useState } from 'react';
import { Alert, Form, Input, Button, Radio, Tabs, message, Tag } from 'antd';
import {
  MailOutlined, LockOutlined, UserOutlined, BankOutlined,
  SafetyCertificateOutlined, CheckCircleFilled,
  SunOutlined, MoonOutlined, DesktopOutlined, ArrowRightOutlined,
  ShoppingCartOutlined, ShopOutlined, FileProtectOutlined,
  AuditOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';
import { useTheme } from '../context/ThemeContext';

export default function UnifiedLogin() {
  const { login } = useAuth();
  const { appearance, setAppearance } = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const accountType = Form.useWatch('account_type', registerForm);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const route = await login(values.email, values.password);
      message.success('Welcome back!');
      navigate(route);
    } catch (e) {
      message.error(e.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (values) => {
    setRegistering(true);
    try {
      await axios.post('/api/register', values);
      
      if (values.account_type === 'supplier') {
        message.success('Supplier account created. Business Admin will verify it before bidding access is enabled.');
        registerForm.resetFields();
        registerForm.setFieldValue('account_type', 'customer');
      } else {
        message.success('Customer account created. Signing you in now.');
        registerForm.resetFields();
        registerForm.setFieldValue('account_type', 'customer');
        try {
          const route = await login(values.email, values.password);
          navigate(route);
          return;
        } catch {
          navigate('/login');
        }
      }
    } catch (e) {
      message.error(e.response?.data?.error || 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="login-split">
      {/* ── Product introduction ── */}
      <div className="login-hero" aria-hidden="true">
        <img className="login-hero-img" src={cdnImages.loginHero} alt="Zambia Procurement" loading="eager" />
        <div className="login-hero-overlay" />
        <div className="login-hero-content">
          <div className="login-hero-top">
            <div className="login-hero-brand">
              <span className="login-hero-logo">
                <SafetyCertificateOutlined style={{ fontSize: 20, color: '#ffffff' }} />
              </span>
              <span className="login-hero-title">Freshstart</span>
              <Tag className="login-hero-brand-tag">Procurement platform</Tag>
            </div>
            <div className="login-system-status">
              <span className="login-system-status-dot" />
              Secure workspace
            </div>
          </div>

          <div className="login-hero-middle">
            <div className="login-hero-eyebrow">One accountable procurement journey</div>
            <h1 className="login-hero-heading">
              From requirement to payment,<br />every step stays clear.
            </h1>
            <p className="login-hero-subheading">
              Bring buyers, verified suppliers, approvals, protected payments and delivery records into one connected workspace.
            </p>

            <div className="login-journey" aria-label="Procurement workflow">
              <div className="login-journey-step">
                <span>01</span>
                <strong>Request</strong>
                <small>Define the need</small>
              </div>
              <ArrowRightOutlined className="login-journey-arrow" />
              <div className="login-journey-step">
                <span>02</span>
                <strong>Compare</strong>
                <small>Review fair offers</small>
              </div>
              <ArrowRightOutlined className="login-journey-arrow" />
              <div className="login-journey-step">
                <span>03</span>
                <strong>Protect</strong>
                <small>Approve and fund</small>
              </div>
              <ArrowRightOutlined className="login-journey-arrow" />
              <div className="login-journey-step">
                <span>04</span>
                <strong>Deliver</strong>
                <small>Complete with proof</small>
              </div>
            </div>

            <div className="login-role-preview">
              <div className="login-role-preview-card">
                <span className="login-role-preview-icon"><ShoppingCartOutlined /></span>
                <div>
                  <strong>For customers</strong>
                  <p>Make requests, compare proposals and follow every order.</p>
                </div>
              </div>
              <div className="login-role-preview-card">
                <span className="login-role-preview-icon"><ShopOutlined /></span>
                <div>
                  <strong>For suppliers</strong>
                  <p>Find opportunities, submit bids and manage delivery.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="login-hero-foot">
            <span><FileProtectOutlined /> Protected payment records</span>
            <span><CheckCircleFilled /> Verified participation</span>
            <span><AuditOutlined /> Traceable decisions</span>
          </div>
        </div>
      </div>

      {/* ── Workspace access ── */}
      <div className="login-form-pane">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-brand-small">
              <div className="login-brand-icon">
                <SafetyCertificateOutlined style={{ fontSize: 18, color: '#0f6b5d' }} />
              </div>
              <span className="login-brand-text">Freshstart</span>
            </div>
            
            <div className="login-theme-toggle">
              <Button
                size="small"
                type="text"
                icon={appearance === 'dark' ? <SunOutlined /> : appearance === 'light' ? <MoonOutlined /> : <DesktopOutlined />}
                onClick={() => setAppearance(appearance === 'dark' ? 'light' : appearance === 'light' ? 'system' : 'dark')}
                title={`Theme: ${appearance}`}
                aria-label={`Change appearance. Current setting: ${appearance}`}
              >
                {appearance.toUpperCase()}
              </Button>
            </div>
          </div>

          <div className="login-mobile-intro">
            <span>One accountable procurement journey</span>
            <strong>Request. Compare. Protect. Deliver.</strong>
          </div>

          <div className="login-card-title-section">
            <span className="login-card-eyebrow">Secure workspace access</span>
            <h2>{activeTab === 'login' ? 'Welcome back' : 'Join Freshstart'}</h2>
            <p>
              {activeTab === 'login'
                ? 'Sign in to continue from your latest procurement activity.'
                : 'Choose your role and create the workspace that fits your work.'}
            </p>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            className="login-tabs"
            items={[
              {
                key: 'login',
                label: 'Sign In',
                children: (
                  <Form form={loginForm} name="login" onFinish={onFinish} layout="vertical" requiredMark={false}>
                    <Form.Item
                      name="email"
                      label="Email Address"
                      rules={[{ required: true, message: 'Please enter your email' }, { type: 'email', message: 'Enter a valid email address' }]}
                    >
                      <Input
                        prefix={<MailOutlined style={{ color: '#94a3b8' }} />}
                        placeholder="you@organization.zm"
                        size="large"
                        autoComplete="username"
                      />
                    </Form.Item>

                    <Form.Item
                      name="password"
                      label="Password"
                      rules={[{ required: true, message: 'Please enter your password' }]}
                    >
                      <Input.Password
                        prefix={<LockOutlined style={{ color: '#94a3b8' }} />}
                        placeholder="••••••••••••"
                        size="large"
                        autoComplete="current-password"
                      />
                    </Form.Item>

                    <Form.Item style={{ marginTop: 24 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        block
                        size="large"
                        icon={<ArrowRightOutlined />}
                        className="login-submit-btn"
                      >
                        Sign In to Workspace
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
              {
                key: 'register',
                label: 'Create Account',
                children: (
                  <Form form={registerForm} name="register" onFinish={onRegister} layout="vertical" initialValues={{ account_type: 'customer' }} requiredMark={false}>
                    <Form.Item name="account_type" label="Choose your workspace" rules={[{ required: true }]}>
                      <Radio.Group className="login-role-selector">
                        <Radio.Button value="customer">
                          <ShoppingCartOutlined />
                          <span><strong>Customer</strong><small>Request and purchase</small></span>
                        </Radio.Button>
                        <Radio.Button value="supplier">
                          <ShopOutlined />
                          <span><strong>Supplier</strong><small>Bid and deliver</small></span>
                        </Radio.Button>
                      </Radio.Group>
                    </Form.Item>

                    {accountType === 'supplier' && (
                      <Alert
                        type="info"
                        showIcon
                        className="login-supplier-note"
                        message={
                          <span>
                            Have your PACRA and ZRA details ready for supplier verification.
                          </span>
                        }
                      />
                    )}

                    <Form.Item name="full_name" label="Full Name" rules={[{ required: true, message: 'Full name required' }]}>
                      <Input prefix={<UserOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="e.g. Mundia J Wamuyuwa" />
                    </Form.Item>

                    <Form.Item name="email" label="Email Address" rules={[{ required: true, type: 'email', message: 'Valid email required' }]}>
                      <Input prefix={<MailOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="you@organization.zm" autoComplete="username" />
                    </Form.Item>

                    <Form.Item name="organization" label={accountType === 'supplier' ? 'Company Name' : 'Organization Name'} rules={[{ required: true, message: 'Organization name required' }]}>
                      <Input prefix={<BankOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="e.g. Freshstart Enterprises Ltd" />
                    </Form.Item>

                    <Form.Item name="registration_number" label="PACRA Registration # (Optional)">
                      <Input prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="e.g. PACRA-2024-00123" />
                    </Form.Item>

                    <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: 'Minimum 8 characters' }]}>
                      <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="At least 8 characters" autoComplete="new-password" />
                    </Form.Item>

                    <Form.Item style={{ marginTop: 20 }}>
                      <Button type="primary" htmlType="submit" loading={registering} block size="large" className="login-submit-btn">
                        Create Account
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
            ]}
          />

          <div className="login-assurance">
            <SafetyCertificateOutlined />
            <span>Your access is role-based and activity is recorded for accountability.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
