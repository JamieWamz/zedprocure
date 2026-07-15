import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { cdnImages } from '../cdnAssets';

export default function UnifiedLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

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
              <Input.Password placeholder="••••••••" size="large" autoComplete="current-password" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                Sign In
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  );
}
