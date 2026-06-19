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
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background:'#f0f2f5' }}>
      <Form name="login" onFinish={onFinish} style={{ width:350, padding:24, background:'#fff', borderRadius:8 }}>
        <h2 style={{ textAlign:'center', marginBottom:24 }}>Sign in to Procurement Portal</h2>
        <Form.Item name="email" rules={[{ required:true, message:'Email required' }]}>
          <Input placeholder="Email" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required:true, message:'Password required' }]}>
          <Input.Password placeholder="Password" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
