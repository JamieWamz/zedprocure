import React, { useEffect, useState } from 'react';
import { Alert, Form, Input, Button, Radio, Tabs, message } from 'antd';
import {
  MailOutlined, LockOutlined, UserOutlined, BankOutlined,
  SafetyCertificateOutlined,
  SunOutlined, MoonOutlined, DesktopOutlined, ArrowRightOutlined,
  ShoppingCartOutlined, ShopOutlined
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { remoteImages } from '../remoteImageAssets';
import { useTheme } from '../context/ThemeContext';
import { strongPasswordRule } from '../utils/passwordValidation';

const LOGIN_HERO_IMAGES = remoteImages.loginHeroes?.length ? remoteImages.loginHeroes : [remoteImages.loginHero];

export default function AuthenticationPage() {
  const { login } = useAuth();
  const { appearance, setAppearance } = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [heroIndex, setHeroIndex] = useState(0);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const accountType = Form.useWatch('account_type', registerForm);

  useEffect(() => {
    LOGIN_HERO_IMAGES.forEach(src => {
      const image = new Image();
      image.src = src;
    });
    if (LOGIN_HERO_IMAGES.length < 2) return undefined;
    const interval = window.setInterval(() => {
      setHeroIndex(index => (index + 1) % LOGIN_HERO_IMAGES.length);
    }, 7000);
    return () => window.clearInterval(interval);
  }, []);

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
      
      message.success(values.account_type === 'supplier'
        ? 'Supplier account created. Opening your verification workspace.'
        : 'Customer account created. Signing you in now.');
      registerForm.resetFields();
      registerForm.setFieldValue('account_type', 'customer');
      try {
        const route = await login(values.email, values.password);
        navigate(route);
        return;
      } catch {
        loginForm.setFieldsValue({ email: values.email });
        setActiveTab('login');
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
        <img
          key={LOGIN_HERO_IMAGES[heroIndex]}
          className="login-hero-img"
          src={LOGIN_HERO_IMAGES[heroIndex]}
          alt=""
          loading={heroIndex === 0 ? 'eager' : 'lazy'}
          onError={() => setHeroIndex(index => (index + 1) % LOGIN_HERO_IMAGES.length)}
        />
        <div className="login-hero-overlay" />
        <div className="login-hero-content">
          <div className="login-hero-top">
            <div className="login-hero-brand">
              <span className="login-hero-logo">
                <SafetyCertificateOutlined style={{ fontSize: 20, color: '#ffffff' }} />
              </span>
              <span className="login-hero-brand-copy">
                <strong>Freshstart</strong>
                <small>Procurement</small>
              </span>
            </div>
          </div>

          <div className="login-hero-middle">
            <div className="login-hero-eyebrow">Connected procurement</div>
            <h1 className="login-hero-heading">
              Procurement,<br />without the noise.
            </h1>
            <p className="login-hero-subheading">
              A focused workspace for customers and suppliers to move from requirement to delivery with clarity.
            </p>

            <div className="login-hero-principles">
              <span>Verified participants</span>
              <span>Protected payments</span>
              <span>Traceable decisions</span>
            </div>
          </div>

          <div className="login-hero-foot">
            One workspace. The right view for every role.
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
                shape="circle"
                type="text"
                icon={appearance === 'dark' ? <SunOutlined /> : appearance === 'light' ? <MoonOutlined /> : <DesktopOutlined />}
                onClick={() => setAppearance(appearance === 'dark' ? 'light' : appearance === 'light' ? 'system' : 'dark')}
                title={`Theme: ${appearance}`}
                aria-label={`Change appearance. Current setting: ${appearance}`}
              />
            </div>
          </div>

          <div className="login-mobile-intro">
            <strong>Procurement, without the noise.</strong>
            <span>One clear workspace for every role.</span>
          </div>

          <div className="login-card-title-section">
            <span className="login-card-eyebrow">Secure workspace access</span>
            <h2>{activeTab === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>
              {activeTab === 'login'
                ? 'Sign in to continue where you left off.'
                : 'Choose the workspace that fits your role.'}
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

                    <Form.Item name="registration_number" label={accountType === 'supplier' ? 'PACRA Registration # (Optional)' : 'Organization Registration # (Optional)'}>
                      <Input prefix={<SafetyCertificateOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="e.g. PACRA-2024-00123" />
                    </Form.Item>

                    <Form.Item
                      name="password"
                      label="Password"
                      rules={[strongPasswordRule]}
                      extra="Use 10+ characters with uppercase, lowercase, a number, and a special character."
                    >
                      <Input.Password prefix={<LockOutlined style={{ color: '#94a3b8' }} />} size="large" placeholder="Create a strong password" autoComplete="new-password" />
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
