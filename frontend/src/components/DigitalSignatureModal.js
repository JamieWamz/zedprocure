import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, List, Modal, Space, Tag, Typography, message } from 'antd';
import { AuditOutlined, CheckCircleOutlined } from '@ant-design/icons';
import axios from 'axios';

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
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!open || !documentType || !documentId) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/signatures/${documentType}/${documentId}`);
      setSignatures(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load signatures');
    } finally {
      setLoading(false);
    }
  }, [documentId, documentType, open]);

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
        consent: values.consent,
      });
      message.success('Digital signature applied');
      form.resetFields();
      await load();
      if (onSigned) onSigned();
    } catch (e) {
      if (e.response) message.error(e.response?.data?.error || 'Failed to sign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span><AuditOutlined /> Digital Signature</span>}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>Close</Button>,
        <Button key="sign" type="primary" icon={<CheckCircleOutlined />} loading={saving} onClick={sign}>Sign Digitally</Button>,
      ]}
      width={680}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={documentLabel || `${documentType} ${documentId}`}
        description="Use this to approve documents in-app without printing, signing, scanning, or emailing paper copies."
      />

      <Form form={form} layout="vertical">
        <Form.Item name="signer_name" label="Legal Name" rules={[{ required: true, min: 2 }]}>
          <Input placeholder="Name as it should appear on the signature record" />
        </Form.Item>
        <Form.Item name="signer_title" label="Title / Capacity">
          <Input placeholder="Procurement Officer, Finance Manager, Director..." />
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
              title={<Space><Text>{signature.signer_name}</Text><Tag>{signature.signer_role || signature.signer_user_type}</Tag></Space>}
              description={`${signature.signer_title || 'Signer'} · ${signature.signer_email || 'no email'} · ${new Date(signature.signed_at).toLocaleString()}`}
            />
            <Text code style={{ fontSize: 11 }}>{signature.signature_hash.slice(0, 16)}</Text>
          </List.Item>
        )}
      />
    </Modal>
  );
}
