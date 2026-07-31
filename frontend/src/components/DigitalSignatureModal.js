import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { AuditOutlined, CheckCircleOutlined, LockOutlined, SafetyCertificateOutlined, WarningOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;

export default function DigitalSignatureModal({
  open,
  onClose,
  documentType,
  documentId,
  documentLabel,
  onSigned,
}) {
  const [form] = Form.useForm();
  const { user } = useAuth();
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!open || !documentType || !documentId) {
      setLoading(false);
      setSignatures([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/signatures/${documentType}/${documentId}`);
      setSignatures(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to load signatures';
      // 403 is expected when the user has no access — show informational message, not error
      if (e.response?.status !== 403) {
        message.error(msg);
      }
      setSignatures([]);
    } finally {
      setLoading(false);
    }
  }, [documentId, documentType, open]);

  // Safety net: clear loading state if it gets stuck (network timeout, etc.)
  useEffect(() => {
    if (!open) {
      setLoading(false);
      setSignatures([]);
      form.resetFields();
      return;
    }
    form.setFieldsValue({ signer_name: user?.full_name || '', consent: false, confirmation_password: '' });
  }, [form, open, user?.full_name]);

  useEffect(() => {
    if (!open || !documentId) return;
    const timeout = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(timeout);
  }, [open, documentId]);

  // Fetch signatures whenever modal opens or the document changes
  useEffect(() => { load(); }, [load]);

  const sign = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await axios.post('/api/signatures', {
        document_type: documentType,
        document_id: documentId,
        signer_name: values.signer_name,
        signer_title: values.signer_title,
        confirmation_password: values.confirmation_password,
        consent: values.consent,
      });
      message.success('Digital signature applied');
      form.setFieldsValue({ signer_name: user?.full_name || '', signer_title: '', confirmation_password: '', consent: false });
      await load();
      if (onSigned) onSigned();
    } catch (e) {
      if (e.response) message.error(e.response?.data?.error || 'Failed to sign');
    } finally {
      setSaving(false);
    }
  };

  const alreadySigned = signatures.some(signature =>
    String(signature.signer_email || '').toLowerCase() === String(user?.email || '').toLowerCase()
  );

  return (
    <Modal
      title={<span><AuditOutlined /> Digital Signature</span>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>Close</Button>,
        <Button key="sign" type="primary" icon={<CheckCircleOutlined />} loading={saving} disabled={alreadySigned} onClick={sign}>
          {alreadySigned ? 'Already signed' : 'Sign securely'}
        </Button>,
      ]}
      width={680}
    >
      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        style={{ marginBottom: 12 }}
        message={documentLabel || `${documentType} ${documentId}`}
        description="A digital signature is permanent. Your password, account identity, document fingerprint, time, and consent are bound into a tamper-evident record."
      />

      <Form form={form} layout="vertical">
        <Form.Item name="signer_name" label="Verified legal name" rules={[{ required: true, min: 2 }]}>
          <Input disabled prefix={<SafetyCertificateOutlined />} />
        </Form.Item>
        <Form.Item name="signer_title" label="Title / Capacity">
          <Input maxLength={120} placeholder="Procurement Officer, Finance Manager, Director..." />
        </Form.Item>
        <Form.Item
          name="confirmation_password"
          label="Confirm your password"
          extra="This re-verifies your identity. Your password is never stored with the signature."
          rules={[{ required: true, message: 'Enter your password to sign' }, { max: 256 }]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="Current account password" />
        </Form.Item>
        <Form.Item
          name="consent"
          valuePropName="checked"
          rules={[{
            validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('Consent is required')),
          }]}
        >
          <Checkbox>I agree to sign this document electronically and understand this digital signature represents my approval.</Checkbox>
        </Form.Item>
      </Form>

      <List
        header={<Text strong>Signature Trail</Text>}
        loading={loading}
        dataSource={signatures}
        locale={{ emptyText: 'No signatures yet' }}
        renderItem={(signature) => (
          <List.Item>
            <List.Item.Meta
              title={(
                <Space wrap>
                  <Text>{signature.signer_name}</Text>
                  <Tag>{signature.signer_role || signature.signer_user_type}</Tag>
                  {signature.integrity_verified === true && <Tag color="success" icon={<SafetyCertificateOutlined />}>Integrity verified</Tag>}
                  {signature.integrity_status === 'legacy' && <Tag color="warning">Legacy signature</Tag>}
                  {signature.integrity_verified === false && <Tag color="error">Integrity check failed</Tag>}
                </Space>
              )}
              description={(
                <Space direction="vertical" size={1}>
                  <Text type="secondary">{signature.signer_title || 'Signer'} · {signature.signer_email || 'no email'} · {new Date(signature.signed_at).toLocaleString()}</Text>
                  {signature.document_hash && (
                    <Text type="secondary">Document fingerprint: <Text code>{signature.document_hash.slice(0, 16)}…</Text> {signature.document_unchanged === false && <Tag color="warning">Document changed since signing</Tag>}</Text>
                  )}
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    </Modal>
  );
}
