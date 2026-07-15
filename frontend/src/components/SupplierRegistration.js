import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Select, Upload, message, Alert, Steps, Card, List, Typography, Tag } from 'antd';
import { UploadOutlined, FileTextOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
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
  const [documentFiles, setDocumentFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleFileChange = (docType, { fileList }) => {
    setDocumentFiles(prev => ({ ...prev, [docType]: fileList.slice(-1) }));
  };

  const handleRegister = async (values) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('email', values.email);
      formData.append('password', values.password);
      formData.append('full_name', values.full_name);
      formData.append('company_name', values.company_name);
      formData.append('registration_number', values.registration_number || '');

      // Append all required document files
      REQUIRED_DOCUMENTS.forEach(doc => {
        const file = documentFiles[doc.type]?.[0]?.originFileObj;
        if (file) {
          formData.append(doc.type, file);
        }
      });

      await axios.post('/api/register-supplier', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      message.success('Supplier account created with documents. Business Admin will review and verify.');
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
          <Form.Item name="company_name" label="Company Name" rules={[{ required: true }]}>
            <Input size="large" placeholder="Enter your company name" />
          </Form.Item>
          <Form.Item name="registration_number" label="Registration Number">
            <Input size="large" placeholder="PACRA registration number" />
          </Form.Item>
          <Form.Item name="full_name" label="Contact Person Full Name" rules={[{ required: true }]}>
            <Input size="large" placeholder="Enter contact person name" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input size="large" placeholder="contact@company.zm" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 10 }]}>
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
          <List
            dataSource={REQUIRED_DOCUMENTS}
            renderItem={doc => (
              <List.Item
                actions={[
                  documentFiles[doc.type]?.[0] ? 
                    <Tag color="success" icon={<CheckCircleOutlined />}>Uploaded</Tag> :
                    <Tag color="warning" icon={<ExclamationCircleOutlined />}>Required</Tag>
                ]}
              >
                <List.Item.Meta
                  title={doc.label}
                  description={doc.description}
                />
                <Form.Item
                  name={doc.type}
                  noStyle
                  rules={[{ required: true, message: `${doc.label} is required` }]}
                >
                  <Upload
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    beforeUpload={() => false}
                    fileList={documentFiles[doc.type] || []}
                    onChange={({ fileList }) => handleFileChange(doc.type, { fileList })}
                  >
                    <Button icon={<UploadOutlined />}>Upload</Button>
                  </Upload>
                </Form.Item>
              </List.Item>
            )}
          />
        </>
      ),
    },
  ];

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
              <Button type="primary" onClick={() => setCurrentStep(currentStep + 1)}>
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