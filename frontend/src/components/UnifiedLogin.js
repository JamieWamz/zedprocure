import React, { useState } from 'react';
import { Alert, Form, Input, Button, Select, Tabs, message, Space } from 'antd';
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
  const [registerForm] = Form.useForm();
  const accountType = Form.useWatch('account_type', registerForm);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const route = await login(values.email, values.password);
      navigate(route);
    } catch {
      message.error('Login failed. Check your credentials.');
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
        // Auto-login for customer accounts
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
      <div className="login-hero" aria-hidden="true">
        <img className="login-hero-img" src={cdnImages.loginHero} alt="" loading="eager" />
        <div className="login-hero-overlay" />
        <div className="login-hero-content">
          <div className="login-hero-brand">
            <span className="login-hero-logo" />
            Freshstart
          </div>
          <div>
            <h1>Zambia Procurement Portal</h1>
            <p>
              Transparent, multi-tenant public procurement — from open bids
              and supplier verification to escrow-backed payments and an
              immutable financial ledger.
            </p>
          </div>
          <span className="login-hero-foot">Secured with JWT · Role-based access</span>
        </div>
      </div>

      <div className="login-form-pane">
        <div className="login-card">
          {/* Mobile brand header — visible only on small screens (class handles visibility) */}
          <div className="login-mobile-brand" style={{ textAlign: 'center', marginBottom: 16, paddingBottom: 16 }}>
            <div className="login-mobile-brand-inner">
              <span className="login-mobile-brand-logo" />
              <span className="login-mobile-brand-name">Freshstart</span>
            </div>
            <div className="login-mobile-brand-tagline">
              Zambia Procurement Portal — Transparent, multi-tenant public procurement
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Space size={6}><span>Appearance</span><Select size="small" value={appearance} onChange={setAppearance} style={{ width: 100 }} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></Space>
          </div>
          <Tabs
            defaultActiveKey="login"
            items={[
              {
                key: 'login',
                label: 'Sign In',
                children: (
                  <>
                    <h2>Sign in to your account</h2>
                    <Form name="login" onFinish={onFinish} layout="vertical">
                      <Form.Item
                        name="email"
                        label="Email"
                        rules={[{ required: true, message: 'Email required' }, { type: 'email', message: 'Enter a valid email' }]}
                      >
                        <Input placeholder="you@organization.zm" size="large" autoComplete="username" />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        label="Password"
                        rules={[{ required: true, message: 'Password required' }]}
                      >
                        <Input.Password placeholder="Password" size="large" autoComplete="current-password" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block size="large">
                          Sign In
                        </Button>
                      </Form.Item>
                    </Form>
                  </>
                ),
              },
              {
                key: 'register',
                label: 'Create Account',
                children: (
                  <>
                    <h2>Create your account</h2>
                    <Form form={registerForm} name="register" onFinish={onRegister} layout="vertical" initialValues={{ account_type: 'customer' }}>
                      <Form.Item name="account_type" label="Account Type" rules={[{ required: true }]}>
                        <Select
                          size="large"
                          options={[
                            { value: 'customer', label: 'Customer / Buyer' },
                            { value: 'supplier', label: 'Supplier' },
                          ]}
                        />
                      </Form.Item>
                         {accountType === 'supplier' && (
                           <Alert 
                             type="info" 
                             showIcon 
                             style={{ marginBottom: 12 }} 
                             message={
                               <span>
                                 Supplier accounts require document upload. 
                                 <a href="/register/supplier" style={{ marginLeft: 8 }}>Register with documents</a>
                               </span>
                             } 
                           />
                         )}
                         <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}>
                        <Input size="large" placeholder="e.g. Mundia J Wamuyuwa" />
                      </Form.Item>
                      <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
                        <Input size="large" placeholder="you@organization.zm" autoComplete="username" />
                      </Form.Item>
                      <Form.Item name="organization" label={accountType === 'supplier' ? 'Company Name' : 'Organization / Buyer Name'} rules={[{ required: true }]}>
                        <Input size="large" placeholder="e.g. Freshstart Enterprises" />
                      </Form.Item>
                      <Form.Item name="registration_number" label="Registration Number">
                        <Input size="large" placeholder="e.g. PACRA-2024-00123" />
                      </Form.Item>
                      <Form.Item name="password" label="Password" rules={[{ required: true, min: 10 }]}>
                        <Input.Password size="large" placeholder="At least 10 characters" autoComplete="new-password" />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={registering} block size="large">
                        Create Account
                      </Button>
                    </Form>
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
