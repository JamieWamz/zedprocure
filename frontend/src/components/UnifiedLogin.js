import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

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
    <div className="login-container">
      <Form name="login" onFinish={onFinish} className="login-card">
        <h2>Sign in to Freshstart Procurement Portal</h2>
        <Form.Item name="email" rules={[{ required:true, message:'Email required' }]}>
          <Input placeholder="Email" size="large" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required:true, message:'Password required' }]}>
          <Input.Password placeholder="Password" size="large" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
