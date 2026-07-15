import React, { useEffect, useState } from 'react';
import { Table, Button, message, Modal, Form, Input, Select, Tag, Space, Card, List, Typography, Alert } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, FileTextOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;

// Required document types for display
const REQUIRED_DOCUMENTS = [
  { type: 'pacra_certificate', label: 'PACRA Certificate' },
  { type: 'zra_tpin', label: 'ZRA TPIN Certificate' },
  { type: 'zra_tax_clearance', label: 'ZRA Tax Clearance' },
  { type: 'business_license', label: 'Business License' },
  { type: 'directors_id', label: 'Directors ID Copies' },
  { type: 'bank_reference', label: 'Bank Reference Letter' }
];

export default function SupplierVerification() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [verifyForm] = Form.useForm();
  const [documentModalVisible, setDocumentModalVisible] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/admin/verification/suppliers');
      setSuppliers(data);
    } catch {
      message.error('Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const handleVerify = async (id, status) => {
    try {
      await axios.put(`/api/admin/suppliers/${id}/verify`, { status });
      message.success(`Supplier ${status} successfully`);
      fetchSuppliers();
    } catch (e) {
      message.error(e.response?.data?.error || 'Verification failed');
    }
  };

  const openVerifyModal = (supplier) => {
    setSelectedSupplier(supplier);
    setModalVisible(true);
    verifyForm.setFieldsValue({ status: 'verified', notes: '' });
  };

  const handleVerifySubmit = async (values) => {
    if (!selectedSupplier) return;
    await handleVerify(selectedSupplier.id, values.status);
    setModalVisible(false);
  };

  const openDocumentModal = (document) => {
    setSelectedDocument(document);
    setDocumentModalVisible(true);
  };

  const handleDocumentVerify = async (status, notes) => {
    if (!selectedDocument) return;
    try {
      await axios.put(
        `/api/admin/suppliers/${selectedDocument.supplier_id}/documents/${selectedDocument.id}/verify`,
        { status, notes }
      );
      message.success(`Document ${status} successfully`);
      setDocumentModalVisible(false);
      fetchSuppliers();
    } catch (e) {
      message.error(e.response?.data?.error || 'Document verification failed');
    }
  };

  const getDocumentStatusTag = (doc) => {
    if (!doc) return <Tag color="warning">Not Uploaded</Tag>;
    const color = doc.verification_status === 'verified' ? 'success' : 
                  doc.verification_status === 'rejected' ? 'error' : 'processing';
    return <Tag color={color}>{doc.verification_status || 'pending'}</Tag>;
  };

  const columns = [
    { 
      title: 'Company', 
      dataIndex: 'company_name',
      render: (text, record) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.registration_number || '-'}</Text>
        </div>
      )
    },
    { 
      title: 'Documents', 
      dataIndex: 'documents', 
      render: docs => (
        <div style={{ maxWidth: 400 }}>
          {REQUIRED_DOCUMENTS.map(doc => {
            const uploaded = docs?.find(d => d.type === doc.type);
            return (
              <div key={doc.type} style={{ marginBottom: 4 }}>
                <Space>
                  <Text style={{ fontSize: 12 }}>{doc.label}:</Text>
                  {getDocumentStatusTag(uploaded)}
                  {uploaded && (
                    <Button 
                      type="link" 
                      size="small" 
                      icon={<EyeOutlined />}
                      onClick={() => openDocumentModal(uploaded)}
                    >
                      View
                    </Button>
                  )}
                </Space>
              </div>
            );
          })}
        </div>
      )
    },
    { 
      title: 'Status', 
      dataIndex: 'verification_status',
      render: text => (
        <Tag color={text === 'verified' ? 'success' : text === 'rejected' ? 'error' : 'warning'}>
          {text?.replace(/_/g, ' ')}
        </Tag>
      )
    },
    { 
      title: 'Action', 
      render: (_, record) => (
        <Space>
          <Button 
            type="primary" 
            size="small" 
            icon={<CheckCircleOutlined />}
            onClick={() => openVerifyModal(record)}
          >
            Review
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <h2>Supplier Verification</h2>
      <Alert
        type="info"
        showIcon
        message="Manual Verification Process"
        description="Review all required documents (PACRA, ZRA, etc.) and approve or reject suppliers. All documents must be verified before the supplier can participate in bids."
        style={{ marginBottom: 16 }}
      />
      <Table 
        dataSource={suppliers} 
        rowKey="id" 
        columns={columns} 
        loading={loading}
        scroll={{ x: 800 }}
      />

      {/* Verify Supplier Modal */}
      <Modal
        title={`Review Supplier: ${selectedSupplier?.company_name}`}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form form={verifyForm} layout="vertical" onFinish={handleVerifySubmit}>
          <Form.Item name="status" label="Verification Decision" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="verified">Approve - Verified</Select.Option>
              <Select.Option value="rejected">Reject - Not Approved</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="notes" label="Notes (optional)">
            <Input.TextArea rows={3} placeholder="Add notes about this verification decision" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Button onClick={() => setModalVisible(false)} style={{ marginRight: 8 }}>Cancel</Button>
            <Button type="primary" htmlType="submit">Submit Decision</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* Document Review Modal */}
      <Modal
        title={`Document: ${selectedDocument?.document_type?.replace(/_/g, ' ')}`}
        open={documentModalVisible}
        onCancel={() => setDocumentModalVisible(false)}
        footer={null}
        width={500}
      >
        {selectedDocument && (
          <div>
            <p><Text strong>File:</Text> <a href={selectedDocument.path} target="_blank" rel="noreferrer">View Document</a></p>
            <p><Text strong>Status:</Text> {getDocumentStatusTag(selectedDocument)}</p>
            <p><Text strong>Uploaded:</Text> {new Date(selectedDocument.upload_date).toLocaleString()}</p>
            
            <Space style={{ marginTop: 16 }}>
              <Button 
                type="primary" 
                icon={<CheckCircleOutlined />}
                onClick={() => handleDocumentVerify('verified', 'Document verified')}
              >
                Approve
              </Button>
              <Button 
                danger 
                icon={<CloseCircleOutlined />}
                onClick={() => handleDocumentVerify('rejected', 'Document rejected - please re-upload')}
              >
                Reject
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
}
