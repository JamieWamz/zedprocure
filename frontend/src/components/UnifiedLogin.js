import React, { useState } from 'react';
import { Alert, Form, Input, Button, Select, Tabs, message, Space, Tag, Tooltip } from 'antd';
import {
  MailOutlined, LockOutlined, UserOutlined, BankOutlined,
  SafetyCertificateOutlined, CheckCircleFilled,
  ThunderboltOutlined, SunOutlined, MoonOutlined, DesktopOutlined,
  ArrowRightOutlined
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
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const accountType = Form.useWatch('account_type', registerForm);

  const fillQuickLogin = (email, password) => {
    loginForm.setFieldsValue({ email, password });
    message.info(`Pre-filled login for ${email}`);
  };

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
      {/* ── Left Hero Side ── */}
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
              <Tag color="blue" style={{ borderRadius: 12, padding: '0 10px', fontSize: 11, border: 'none', background: 'rgba(37, 99, 235, 0.4)', color: '#93c5fd' }}>
                Zambia Procurement
              </Tag>
            </div>
          </div>

          <div className="login-hero-middle">
            <h1 className="login-hero-heading">
              Transparent & Escrow-Backed <br />
              Public Procurement.
            </h1>
            <p className="login-hero-subheading">
              Connecting Zambian public buyers, corporate procurement teams, and verified suppliers with multi-tier digital signatures and automated ledger settlement.
            </p>

            <div className="login-hero-pills">
              <div className="login-pill">
                <CheckCircleFilled style={{ color: '#10b981' }} />
                <span>Escrow Payments (MTN / Airtel / Zanaco)</span>
              </div>
              <div className="login-pill">
                <CheckCircleFilled style={{ color: '#10b981' }} />
                <span>PACRA & ZRA Compliance Verification</span>
              </div>
              <div className="login-pill">
                <CheckCircleFilled style={{ color: '#10b981' }} />
                <span>Real-Time Evaluation Scorecards</span>
              </div>
            </div>
          </div>

          <div className="login-hero-foot">
            <Space size={16}>
              <span>🔒 Encrypted TLS 1.3</span>
              <span>•</span>
              <span>⚡ Real-Time Ledger</span>
              <span>•</span>
              <span>🇿🇲 GRZ Standard</span>
            </Space>
          </div>
        </div>
      </div>

      {/* ── Right Form Pane ── */}
      <div className="login-form-pane">
        <div className="login-card">
          {/* Header Bar: Brand + Theme Toggle */}
          <div className="login-card-header">
            <div className="login-brand-small">
              <div className="login-brand-icon">
                <SafetyCertificateOutlined style={{ fontSize: 18, color: '#2563eb' }} />
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
              >
                {appearance.toUpperCase()}
              </Button>
            </div>
          </div>

          {/* Headline */}
          <div className="login-card-title-section">
            <h2>Welcome Back</h2>
            <p>Access your procurement dashboard, active bids, and escrow records.</p>
          </div>

          {/* Quick Demo Login Preset Buttons */}
          <div className="login-quick-fill">
            <span className="login-quick-label">Quick Demo Access:</span>
            <div className="login-quick-buttons">
              <Tooltip title="Log in as Business Admin">
                <Tag color="purple" style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 6 }} onClick={() => fillQuickLogin('admin@freshstart.zm', 'admin123456')}>
                  👑 Admin
                </Tag>
              </Tooltip>
              <Tooltip title="Log in as Buyer / Customer">
                <Tag color="blue" style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 6 }} onClick={() => fillQuickLogin('buyer@lusaka.gov.zm', 'buyer123456')}>
                  🏢 Buyer
                </Tag>
              </Tooltip>
              <Tooltip title="Log in as Supplier">
                <Tag color="green" style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 6 }} onClick={() => fillQuickLogin('contact@zambiabuild.zm', 'supplier123456')}>
                  🚚 Supplier
                </Tag>
              </Tooltip>
            </div>
          </div>

          {/* Form Tabs: Sign In / Create Account */}
          <Tabs
            defaultActiveKey="login"
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
                    <Form.Item name="account_type" label="I want to register as:" rules={[{ required: true }]}>
                      <Select
                        size="large"
                        options={[
                          { value: 'customer', label: '🏢 Customer / Buyer (Procurement Officer)' },
                          { value: 'supplier', label: '🚚 Supplier / Vendor (Bidding Contractor)' },
                        ]}
                      />
                    </Form.Item>

                    {accountType === 'supplier' && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16, borderRadius: 8 }}
                        message={
                          <span style={{ fontSize: 13 }}>
                            Suppliers must provide PACRA & ZRA details for compliance.
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
        </div>
      </div>
    </div>
  );
}
