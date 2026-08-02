import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';

const { Title, Text } = Typography;

export default function AcceptInvite() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('token');
    if (t) {
      setToken(t);
    } else {
      message.error('Invalid or missing invitation token.');
    }
  }, [location]);

  const onFinish = async (values) => {
    if (!token) return message.error('No token found. Please use the link from your email.');
    setLoading(true);
    try {
      await axios.post('/api/accept-invitation', { ...values, token });
      message.success('Account created successfully! You can now log in.');
      navigate('/login');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to accept invitation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `url(${cdnImages.loginHero}) no-repeat center center fixed`,
      backgroundSize: 'cover'
    }}>
      <Card style={{ width: 400, maxWidth: 'calc(100vw - 24px)', padding: 24, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0 }}>Accept Invitation</Title>
          <Text type="secondary">Complete your profile to get started.</Text>
        </div>

        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="full_name" label="Full Name" rules={[{ required: true }]}>
            <Input size="large" placeholder="John Doe" />
          </Form.Item>
          
          <Form.Item 
            name="company_name" 
            label="Company Name" 
            extra="Required if you were invited as a supplier."
          >
            <Input size="large" placeholder="Your Company Ltd" />
          </Form.Item>
          
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password size="large" placeholder="Create a strong password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Create Account
          </Button>
        </Form>
      </Card>
    </div>
  );
}
