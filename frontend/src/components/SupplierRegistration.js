import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Upload, message, Alert, Steps, Card, Typography, Row, Col } from 'antd';
import { UploadOutlined, InboxOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { cdnImages } from '../cdnAssets';

const { Step } = Steps;
const { Text } = Typography;

// Required document types for Zambian suppliers
const REQUIRED_DOCUMENTS = [
  { type: 'pacra_certificate', label: 'PACRA Certificate', description: 'Certificate of Incorporation from Patents and Companies Registration Authority' },
  { type: 'zra_tpin', label: 'ZRA TPIN Certificate', description: 'Taxpayer Identification Number certificate from Zambia Revenue Authority' },
  { type: 'zra_tax_clearance', label: 'ZRA Tax Clearance', description: 'Tax clearance certificate from Zambia Revenue Authority' },
  { type: 'business_license', label: 'Business License', description: 'License from local municipal authority' },
  { type: 'directors_id', label: 'Directors ID Copies', description: 'Copies of ID documents for company directors' },
  { type: 'bank_reference', label: 'Bank Reference Letter', description: 'Reference letter from the company bank' }
];

export default function SupplierRegistration() {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (values) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      // Append text fields
      formData.append('email', values.email);
      formData.append('password', values.password);
      formData.append('full_name', values.full_name);
      formData.append('company_name', values.company_name);
      formData.append('registration_number', values.registration_number || '');

      REQUIRED_DOCUMENTS.forEach(doc => {
        const file = values[doc.type]?.[0]?.originFileObj;
        if (file) {
          formData.append(doc.type, file);
        }
      });

      await axios.post('/api/register-supplier', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      message.success('Supplier account created with documents. Business Admin will review and verify.');
      form.resetFields();
      setCurrentStep(0);
      navigate('/login');
    } catch (e) {
      message.error(e.response?.data?.error || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    {
      title: 'Company Info',
      content: (
        <>
          <Form.Item 
            name="company_name" 
            label="Company Name" 
            rules={[{ required: true }]}
            extra="Enter the full legal name of your company as registered with PACRA"
          >
            <Input size="large" placeholder="e.g., ABC Trading Limited" />
          </Form.Item>
          <Form.Item 
            name="registration_number" 
            label="Registration Number"
            extra="PACRA registration number (e.g., 120190000123)"
          >
            <Input size="large" placeholder="120190000123" />
          </Form.Item>
          <Form.Item 
            name="full_name" 
            label="Contact Person Full Name" 
            rules={[{ required: true }]}
            extra="Name of the person who will manage this account"
          >
            <Input size="large" placeholder="e.g., John Mwape Banda" />
          </Form.Item>
          <Form.Item 
            name="email" 
            label="Email" 
            rules={[{ required: true, type: 'email' }]}
            extra="A valid email address for account notifications"
          >
            <Input size="large" placeholder="contact@company.zm" />
          </Form.Item>
          <Form.Item 
            name="password" 
            label="Password" 
            rules={[{ required: true, min: 10 }]}
            extra="Minimum 10 characters. Use a strong password for security"
          >
            <Input.Password size="large" placeholder="Create a secure password" />
          </Form.Item>
        </>
      ),
    },
    {
      title: 'Required Documents',
      content: (
        <>
          <Alert
            type="info"
            showIcon
            message="Required Documents for Zambian Suppliers"
            description="All documents must be uploaded for your account to be reviewed. Accepted formats: PDF, DOC, DOCX, JPG, PNG (max 10MB each)."
            style={{ marginBottom: 16 }}
          />
          <Row gutter={[16, 16]}>
            {REQUIRED_DOCUMENTS.map(doc => (
              <Col xs={24} sm={12} key={doc.type}>
                <Form.Item
                  name={doc.type}
                  label={doc.label}
                  valuePropName="fileList"
                  getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList}
                  rules={[{ required: true, message: `Please upload your ${doc.label}` }]}
                  help={doc.description}
                >
                  <Upload.Dragger
                    name={doc.type}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    beforeUpload={() => false}
                    maxCount={1}
                  >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">Click or drag file to upload</p>
                  </Upload.Dragger>
                </Form.Item>
              </Col>
            ))}
          </Row>
        </>
      ),
    },
  ];

  const nextStep = async () => {
    const fields = currentStep === 0
      ? ['company_name', 'registration_number', 'full_name', 'email', 'password']
      : REQUIRED_DOCUMENTS.map(doc => doc.type);
    try {
      await form.validateFields(fields);
      setCurrentStep(step => Math.min(step + 1, steps.length - 1));
    } catch {
      // Ant Design displays the field-level validation messages.
    }
  };

  return (
    <div 
      style={{ 
        maxWidth: 800, 
        margin: '40px auto', 
        padding: 24,
        backgroundImage: `url(${cdnImages.registration})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        minHeight: '100vh',
        borderRadius: 8
      }}
    >
      <Card 
        title="Supplier Registration - Zambia Procurement Portal"
        style={{ 
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)'
        }}
      >
        <Steps current={currentStep} style={{ marginBottom: 24 }}>
          {steps.map(step => (
            <Step key={step.title} title={step.title} />
          ))}
        </Steps>
        
        <Form form={form} layout="vertical" onFinish={handleRegister}>
          {steps[currentStep].content}
          
          <Form.Item style={{ marginTop: 24, textAlign: 'right' }}>
            {currentStep > 0 && (
              <Button style={{ marginRight: 8 }} onClick={() => setCurrentStep(currentStep - 1)}>
                Previous
              </Button>
            )}
            {currentStep < steps.length - 1 && (
              <Button type="primary" onClick={nextStep}>
                Next
              </Button>
            )}
            {currentStep === steps.length - 1 && (
              <Button type="primary" htmlType="submit" loading={submitting}>
                Register Supplier
              </Button>
            )}
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
