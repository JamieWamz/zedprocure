import React, { useEffect, useState } from 'react';
import { Table, Button, message, Modal, Form, Input, Select, Tag, Space, Card, List, Typography, Alert } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { cdnImages } from '../cdnAssets';

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
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

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
      const errorMsg = e.response?.data?.error || 'Verification failed';
      // Procurement-standard error feedback
      const procurementErrors = {
        tax_clearance: 'Verification failed: Missing mandatory Tax Compliance document (ZRA Tax Clearance). Please ensure the supplier has uploaded this document before approving.',
        pacra_certificate: 'Verification failed: Missing mandatory Certificate of Incorporation (PACRA). Please ensure the supplier has uploaded their PACRA certificate.',
        zra_tpin: 'Verification failed: Missing mandatory ZRA TPIN Certificate. Please ensure the supplier has uploaded their TPIN.',
        business_license: 'Verification failed: Missing mandatory Business License. Suppliers must hold a valid trading license.',
        directors_id: 'Verification failed: Missing mandatory Directors ID copies. Please ensure copies of all directors IDs are uploaded.',
        bank_reference: 'Verification failed: Missing mandatory Bank Reference Letter. Please ensure a valid bank reference is on file.',
      };
      const matchedKey = Object.keys(procurementErrors).find(key =>
        errorMsg.toLowerCase().includes(key.replace(/_/g, ' ')) || errorMsg.toLowerCase().includes(key)
      );
      if (matchedKey) {
        message.error(procurementErrors[matchedKey]);
      } else {
        message.error(errorMsg);
      }
    }
  };

  const openVerifyModal = (supplier) => {
    setSelectedSupplier(supplier);
    setModalVisible(true);
    verifyForm.setFieldsValue({ status: 'verified', notes: '' });
  };

  const openRejectModal = (supplier) => {
    setSelectedSupplier(supplier);
    setRejectModalVisible(true);
    setRejectNotes('');
  };

  const handleVerifySubmit = async (values) => {
    if (!selectedSupplier) return;
    await handleVerify(selectedSupplier.id, values.status);
    setModalVisible(false);
  };

  const handleRejectSubmit = async () => {
    if (!selectedSupplier) return;
    if (!rejectNotes || !rejectNotes.trim()) {
      message.error('A rejection reason is required. Please provide specific feedback on what documents or information are missing.');
      return;
    }
    try {
      await axios.put(`/api/admin/suppliers/${selectedSupplier.id}/verify`, {
        status: 'rejected',
        notes: rejectNotes.trim(),
      });
      message.success('Supplier rejected. A notification has been sent with the reason.');
      setRejectModalVisible(false);
      setSelectedSupplier(null);
      setRejectNotes('');
      fetchSuppliers();
    } catch (e) {
      const errorMsg = e.response?.data?.error || 'Rejection failed';
      if (errorMsg.toLowerCase().includes('required') || errorMsg.toLowerCase().includes('reason')) {
        message.error('Rejection failed: A detailed reason is required. Please explain what compliance requirements the supplier did not meet.');
      } else {
        message.error(errorMsg);
      }
    }
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
      const errorMsg = e.response?.data?.error || 'Document verification failed';
      if (status === 'rejected' && errorMsg.toLowerCase().includes('missing')) {
        message.error(`Document rejected: ${errorMsg}. Please notify the supplier to re-upload a compliant document.`);
      } else if (errorMsg.toLowerCase().includes('format') || errorMsg.toLowerCase().includes('file')) {
        message.error(`Document verification failed: The file appears to be in an incorrect format or corrupted. Allowed formats: PDF, DOC, DOCX, JPG, PNG.`);
      } else {
        message.error(`Document verification action failed: ${errorMsg}`);
      }
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
              Approve
            </Button>
            <Button 
              danger 
              size="small" 
              icon={<CloseCircleOutlined />}
              onClick={() => openRejectModal(record)}
            >
              Reject
            </Button>
          </Space>
      )
    }
  ];

  return (
    <div>
      <div className="page-media-banner" style={{ backgroundImage: `url(${cdnImages.verification})` }}>
        <div>
          <h2>Supplier Verification</h2>
          <p>Review and verify supplier documents (PACRA, ZRA, etc.) before they can participate in bids.</p>
        </div>
        <div className="page-media-actions">
          <Button icon={<ReloadOutlined />} onClick={fetchSuppliers} loading={loading}>Refresh</Button>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message="Manual Verification Process"
        description="Review all required documents (PACRA, ZRA, etc.) and approve or reject suppliers. All documents must be verified before the supplier can participate in bids."
        style={{ margin: '16px 0' }}
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

      {/* Reject Supplier Modal */}
      <Modal
        title={`Reject Supplier: ${selectedSupplier?.company_name}`}
        open={rejectModalVisible}
        onCancel={() => { setRejectModalVisible(false); setSelectedSupplier(null); setRejectNotes(''); }}
        footer={[
          <Button key="cancel" onClick={() => { setRejectModalVisible(false); setSelectedSupplier(null); setRejectNotes(''); }}>
            Cancel
          </Button>,
          <Button key="submit" danger loading={loading} onClick={handleRejectSubmit}>
            Reject Supplier
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          message="Rejection requires a detailed reason"
          description="Providing clear feedback helps suppliers understand what compliance requirements they did not meet and how to rectify issues before re-applying."
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical">
          <Form.Item
            label="Rejection Reason"
            required
            help="This will be sent to the supplier via email and in-app notification"
          >
            <Input.TextArea
              rows={4}
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
              placeholder="e.g. Missing mandatory Tax Compliance document (ZRA Tax Clearance). Please upload a valid tax clearance certificate and re-submit for review."
            />
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
        <p><Text strong>Category:</Text> <Tag>{selectedDocument.document_category || 'required'}</Tag></p>
        <p><Text strong>Uploaded:</Text> {new Date(selectedDocument.upload_date).toLocaleString()}</p>
            
            <Space style={{ marginTop: 16 }}>
              <Button 
                type="primary" 
                icon={<CheckCircleOutlined />}
                onClick={() => handleDocumentVerify('verified', 'Document verified - meets compliance requirements')}
              >
                Approve Document
              </Button>
              <Button 
                danger 
                icon={<CloseCircleOutlined />}
                onClick={() => handleDocumentVerify('rejected', 'Document rejected - does not meet compliance requirements')}
              >
                Reject Document
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
}