import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, Form, Select, Input, Button, Steps, Result, Alert, Divider,
  Space, Typography, Tag, Spin, List, Empty,
} from 'antd';
import {
  MobileOutlined, BankOutlined, CheckCircleFilled, CloseCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const { Option } = Select;
const { Text, Title } = Typography;

const PROVIDERS = [
  {
    value: 'mtn',
    label: 'MTN Mobile Money',
    icon: '🟡',
    hint: 'Instantly deducted from your MTN wallet. Enter your MTN number (260 97...)',
    prefix: '260 97/96',
    type: 'mobile',
  },
  {
    value: 'airtel',
    label: 'Airtel Money',
    icon: '🔴',
    hint: 'Instantly deducted from your Airtel Money wallet. Enter your Airtel number (260 97/77...)',
    prefix: '260 97/77',
    type: 'mobile',
  },
  {
    value: 'zamtel',
    label: 'Zamtel Kwacha',
    icon: '🟢',
    hint: 'Instantly deducted from your Zamtel Kwacha wallet. Enter your Zamtel number (260 96...)',
    prefix: '260 96',
    type: 'mobile',
  },
  {
    value: 'bank',
    label: 'Bank Transfer',
    icon: '🏦',
    hint: 'Payment processed within 1–2 business days. You will receive bank details after confirmation.',
    prefix: null,
    type: 'bank',
  },
];

/**
 * PaymentModal
 *
 * Props:
 *   open         {boolean}  - Whether the modal is visible
 *   onClose      {function} - Called when the modal is closed
 *   orderId      {string}   - UUID of the order to pay for
 *   amount       {number}   - ZMW amount
 *   orderLabel   {string}   - Human-readable order description
 *   onSuccess    {function} - Called when payment confirms as successful
 */
export default function PaymentModal({ open, onClose, orderId, amount, orderLabel, onSuccess }) {
  const [step, setStep] = useState(0);       // 0=select, 1=waiting, 2=done
  const [form] = Form.useForm();
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [paymentLogId, setPaymentLogId] = useState(null);
  const [finalStatus, setFinalStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep(0);
      setPaymentLogId(null);
      setFinalStatus(null);
      setError(null);
      form.resetFields();
      fetchHistory();
    }
    return () => clearPoll();
  }, [open]);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function fetchHistory() {
    if (!orderId) return;
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`/api/payments/mobile/order/${orderId}`);
      setHistory(data);
    } catch (_) {}
    finally { setHistoryLoading(false); }
  }

  function startPolling(logId) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/payments/mobile/${logId}/status`);
        if (data.status === 'successful') {
          clearPoll();
          setFinalStatus('successful');
          setStep(2);
          if (onSuccess) onSuccess();
        } else if (data.status === 'failed') {
          clearPoll();
          setFinalStatus('failed');
          setStep(2);
        }
      } catch (_) {}
    }, 4000); // poll every 4 seconds
  }

  async function handleSubmit(values) {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/payments/mobile/initiate', {
        provider: values.provider,
        amount,
        msisdn: values.msisdn,
        orderId,
        description: `Payment for ${orderLabel || orderId}`,
      });
      setPaymentLogId(data.paymentLogId);
      setStep(1);

      if (values.provider === 'bank') {
        // Bank payments confirm asynchronously — show pending state
        setFinalStatus('pending_bank');
        setStep(2);
      } else {
        startPolling(data.paymentLogId);
      }
    } catch (e) {
      const msg = e.response?.data?.error || 'Failed to initiate payment. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    clearPoll();
    onClose();
  }

  const providerMeta = PROVIDERS.find(p => p.value === selectedProvider);

  return (
    <Modal
      title={
        <Space>
          <MobileOutlined style={{ color: '#1677ff' }} />
          <span>Pay for Order</span>
          {orderLabel && <Tag color="blue">{orderLabel}</Tag>}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      width={560}
      maskClosable={step !== 1} // Can't accidentally close while waiting
    >
      {/* Amount banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #0050b3 100%)',
        borderRadius: 10, padding: '16px 20px', marginBottom: 20, color: '#fff',
      }}>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>Amount Due</Text>
        <Title level={2} style={{ margin: 0, color: '#fff' }}>
          ZMW {Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Title>
      </div>

      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Select Method' },
          { title: 'Confirm on Phone' },
          { title: 'Done' },
        ]}
      />

      {/* ── Step 0: Provider selection ─────────────────────────────────── */}
      {step === 0 && (
        <>
          {error && (
            <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />
          )}
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item name="provider" label="Payment Method" rules={[{ required: true, message: 'Please select a payment method' }]}>
              <Select
                size="large"
                placeholder="Choose how you want to pay"
                onChange={v => { setSelectedProvider(v); form.setFieldValue('msisdn', ''); }}
              >
                {PROVIDERS.map(p => (
                  <Option key={p.value} value={p.value}>
                    <Space>
                      <span>{p.icon}</span>
                      <span>{p.label}</span>
                    </Space>
                  </Option>
                ))}
              </Select>
            </Form.Item>

            {providerMeta && (
              <Alert
                type="info"
                showIcon={false}
                message={providerMeta.hint}
                style={{ marginBottom: 16, fontSize: 12 }}
              />
            )}

            {providerMeta?.type === 'mobile' && (
              <Form.Item
                name="msisdn"
                label="Mobile Number"
                rules={[
                  { required: true, message: 'Enter your mobile number' },
                  { pattern: /^260\d{9}$/, message: 'Must be in format 260XXXXXXXXX (12 digits)' },
                ]}
              >
                <Input
                  size="large"
                  placeholder="260971234567"
                  prefix={<MobileOutlined style={{ color: '#999' }} />}
                  maxLength={12}
                />
              </Form.Item>
            )}

            {providerMeta?.type === 'bank' && (
              <Alert
                type="warning"
                showIcon
                message="Bank transfer details will be sent to your registered email. Payment is processed within 1–2 business days."
                style={{ marginBottom: 16 }}
              />
            )}

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
                icon={providerMeta?.type === 'bank' ? <BankOutlined /> : <MobileOutlined />}
              >
                {providerMeta?.type === 'bank'
                  ? 'Request Bank Transfer'
                  : `Pay ZMW ${Number(amount || 0).toLocaleString()}`}
              </Button>
            </Form.Item>
          </Form>

          {/* Payment History for this order */}
          {history.length > 0 && (
            <>
              <Divider>Previous payment attempts</Divider>
              <List
                size="small"
                loading={historyLoading}
                dataSource={history}
                renderItem={h => (
                  <List.Item>
                    <Space>
                      <Tag>{h.provider.toUpperCase()}</Tag>
                      <Text>ZMW {Number(h.amount).toLocaleString()}</Text>
                      <Tag color={h.status === 'successful' ? 'success' : h.status === 'failed' ? 'error' : 'processing'}>
                        {h.status}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(h.created_at).toLocaleString()}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </>
          )}
        </>
      )}

      {/* ── Step 1: Waiting for mobile confirmation ─────────────────────── */}
      {step === 1 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: '#1677ff' }} />} />
          <Title level={4} style={{ marginTop: 20 }}>Waiting for confirmation...</Title>
          <Text type="secondary">
            A payment prompt has been sent to your phone.<br />
            Please open your {PROVIDERS.find(p => p.value === selectedProvider)?.label} app and approve the payment.
          </Text>
          <div style={{ marginTop: 24 }}>
            <Button danger onClick={() => { clearPoll(); setStep(0); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Done ────────────────────────────────────────────────── */}
      {step === 2 && (
        <Result
          icon={
            finalStatus === 'successful'
              ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 64 }} />
              : finalStatus === 'pending_bank'
              ? <BankOutlined style={{ color: '#1677ff', fontSize: 64 }} />
              : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 64 }} />
          }
          status={finalStatus === 'successful' ? 'success' : finalStatus === 'failed' ? 'error' : 'info'}
          title={
            finalStatus === 'successful' ? 'Payment Successful!'
            : finalStatus === 'pending_bank' ? 'Bank Transfer Requested'
            : 'Payment Failed'
          }
          subTitle={
            finalStatus === 'successful'
              ? 'Your payment has been received. The escrow account for this order has been funded.'
              : finalStatus === 'pending_bank'
              ? 'Bank transfer details have been sent to your email. Payment will be confirmed within 1–2 business days.'
              : 'The payment was not completed. You can try again with the same or a different payment method.'
          }
          extra={[
            finalStatus === 'failed' && (
              <Button key="retry" type="primary" onClick={() => { setStep(0); setFinalStatus(null); form.resetFields(); }}>
                Try Again
              </Button>
            ),
            <Button key="close" onClick={handleClose}>Close</Button>,
          ].filter(Boolean)}
        />
      )}
    </Modal>
  );
}
