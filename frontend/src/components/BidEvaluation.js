import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Spin, Alert, Button, message, Modal, Form, Input, InputNumber, Select, Space, Descriptions, Divider, Tabs, Statistic } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, TrophyOutlined, FileTextOutlined, DollarOutlined, StarOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';

const { Text, Title } = Typography;

const EVALUATION_CRITERIA = [
  'Price Competitiveness',
  'Technical Compliance',
  'Delivery Timeline',
  'Quality Assurance',
  'Past Performance',
  'Local Content',
  'Sustainability',
  'Innovation',
];

export default function BidEvaluation() {
  const { bidId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bid, setBid] = useState(null);
  const [responses, setResponses] = useState({ boq_items: [], responses: [] });
  const [evaluationScores, setEvaluationScores] = useState([]);

  // Score modal state
  const [scoreModalVisible, setScoreModalVisible] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [scoreForm] = Form.useForm();

  // Award modal state
  const [awardModalVisible, setAwardModalVisible] = useState(false);
  const [awardSupplier, setAwardSupplier] = useState(null);
  const [awardForm] = Form.useForm();
  const [awarding, setAwarding] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [bidRes, responsesRes, evalRes] = await Promise.all([
        axios.get(`/api/bids/${bidId}`),
        axios.get(`/api/bids/${bidId}/responses`),
        axios.get(`/api/bids/${bidId}/evaluation`).catch(() => ({ data: [] })),
      ]);
      setBid(bidRes.data);
      setResponses(responsesRes.data);
      setEvaluationScores(evalRes.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load evaluation data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (bidId) fetchData(); }, [bidId]);

  // ─── Scoring ──────────────────────────────────────────────────────────────
  const openScoreModal = (supplierId, supplierName) => {
    setSelectedSupplier({ id: supplierId, name: supplierName });
    scoreForm.resetFields();
    setScoreModalVisible(true);
  };

  const handleScoreSubmit = async (values) => {
    try {
      await axios.post(`/api/bids/${bidId}/evaluate`, {
        supplier_id: selectedSupplier.id,
        criteria_name: values.criteria_name,
        score: values.score,
        weight: values.weight || 1,
        comments: values.comments || null,
      });
      message.success(`Score saved for ${selectedSupplier.name}`);
      setScoreModalVisible(false);
      fetchData();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save score');
    }
  };

  // ─── Awarding ─────────────────────────────────────────────────────────────
  const openAwardModal = (supplierId, supplierName, totalPrice) => {
    setAwardSupplier({ id: supplierId, name: supplierName, total: totalPrice });
    awardForm.setFieldsValue({
      supplier_id: supplierId,
      total_amount: totalPrice,
    });
    setAwardModalVisible(true);
  };

  const handleAwardSubmit = async (values) => {
    setAwarding(true);
    try {
      const res = await axios.post(`/api/bids/${bidId}/award`, {
        supplier_id: values.supplier_id,
        total_amount: values.total_amount,
        contract_file_path: values.contract_file_path || null,
        award_notes: values.award_notes || null,
      });
      message.success(`Bid awarded to ${awardSupplier.name}. Order #${res.data.id} created.`);
      setAwardModalVisible(false);
      navigate('/admin/orders');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to award bid');
    } finally {
      setAwarding(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" message={error} showIcon style={{ margin: 24 }} />;
  if (!bid) return <Alert type="warning" message="Bid not found" showIcon />;

  // ─── Build comparison table columns ───────────────────────────────────────
  const boqColumns = [
    { title: '#', width: 40, render: (_, __, idx) => idx + 1 },
    { title: 'Item Description', dataIndex: 'item_description' },
    { title: 'UoM', dataIndex: 'unit_of_measure', width: 60, render: v => <Tag>{v}</Tag> },
    { title: 'Qty', dataIndex: 'quantity', width: 80, render: v => Number(v).toLocaleString() },
  ];

  // Add a column for each supplier response
  const supplierPriceMap = {};
  for (const resp of responses.responses) {
    const sid = resp.supplier_id;
    supplierPriceMap[sid] = {};
    for (const li of (resp.line_item_prices || [])) {
      supplierPriceMap[sid][li.bid_line_item_id] = li;
    }
    boqColumns.push({
      title: <span style={{ fontSize: 11 }}>{resp.supplier_name}<br />Unit Price</span>,
      width: 120,
      render: (_, record) => {
        const price = supplierPriceMap[resp.supplier_id]?.[record.id];
        return price ? (
          <Text strong style={{ fontSize: 12 }}>
            ZMW {Number(price.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </Text>
        ) : <Text type="secondary">-</Text>;
      },
    });
    boqColumns.push({
      title: <span style={{ fontSize: 11 }}>{resp.supplier_name}<br />Total</span>,
      width: 120,
      render: (_, record) => {
        const price = supplierPriceMap[resp.supplier_id]?.[record.id];
        if (!price) return <Text type="secondary">-</Text>;
        const total = Number(price.unit_price) * Number(record.quantity);
        return (
          <Text strong style={{ fontSize: 12 }}>
            ZMW {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </Text>
        );
      },
    });
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Bid Evaluation: {bid.title}</Title>
          <Text type="secondary">
            {bid.evaluation_method === 'lowest_price' ? 'Lowest Price Evaluation' : 'Best Value Evaluation'} 
            {' · '}{responses.responses.length} supplier response{responses.responses.length !== 1 ? 's' : ''}
          </Text>
        </div>
        <Tag color="orange" style={{ fontSize: 14, padding: '2px 12px' }}>{bid.status.toUpperCase()}</Tag>
      </div>

      <Tabs defaultActiveKey="comparison" items={[
        {
          key: 'comparison',
          label: <span><DollarOutlined /> Price Comparison</span>,
          children: (
            <Card title="Line-Item Price Comparison Across Suppliers">
              {responses.boq_items.length > 0 && responses.responses.length > 0 ? (
                <Table
                  dataSource={responses.boq_items}
                  rowKey="id"
                  columns={boqColumns}
                  pagination={false}
                  size="small"
                  bordered
                  scroll={{ x: 'max-content' }}
                />
              ) : (
                <Alert type="info" showIcon message="No supplier responses with pricing to compare yet." />
              )}

              {/* Supplier Totals Summary */}
              {responses.responses.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <Title level={5}>Supplier Totals</Title>
                  <Space wrap>
                    {responses.responses.map(resp => (
                      <Card key={resp.supplier_id} size="small" style={{ minWidth: 200, background: '#f6ffed' }}>
                        <Statistic
                          title={resp.supplier_name}
                          value={resp.total_price}
                          precision={2}
                          prefix={<DollarOutlined />}
                          suffix="ZMW"
                          valueStyle={{ color: '#389e0d', fontWeight: 700 }}
                        />
                        <Text type="secondary">{resp.line_items_count} line items priced</Text>
                      </Card>
                    ))}
                  </Space>
                </div>
              )}
            </Card>
          ),
        },
        {
          key: 'evaluation',
          label: <span><StarOutlined /> Evaluation Scores</span>,
          children: (
            <Card title="Best-Value Evaluation Scores">
              {evaluationScores && evaluationScores.length > 0 ? (
                <div>
                  {evaluationScores.map(entry => {
                    const finalScore = entry.total_weight > 0 ? entry.weighted_score_sum / entry.total_weight : 0;
                    return (
                      <Card key={entry.supplier_id} size="small" style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <Text strong style={{ fontSize: 16 }}>{entry.supplier_name}</Text>
                          <Tag color={finalScore >= 70 ? 'success' : finalScore >= 50 ? 'warning' : 'error'}>
                            Weighted Score: {finalScore.toFixed(2)}
                          </Tag>
                        </div>
                        <Table
                          dataSource={entry.criteria}
                          rowKey="criteria_name"
                          pagination={false}
                          size="small"
                          columns={[
                            { title: 'Criteria', dataIndex: 'criteria_name' },
                            { title: 'Score', dataIndex: 'score', render: v => <Text strong>{v}/100</Text> },
                            { title: 'Weight', dataIndex: 'weight' },
                            { title: 'Weighted Score', render: (_, r) => (Number(r.score) * Number(r.weight)).toFixed(2) },
                            { title: 'Comments', dataIndex: 'comments', render: v => v || '-' },
                          ]}
                        />
                        <Button
                          type="link"
                          size="small"
                          icon={<StarOutlined />}
                          onClick={() => openScoreModal(entry.supplier_id, entry.supplier_name)}
                        >
                          Add/Edit Criteria
                        </Button>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Alert type="info" showIcon message="No evaluation scores yet. Use the form below to score suppliers." />
              )}

              <Divider />
              <Title level={5}>Score a Supplier</Title>
              <Form form={scoreForm} layout="inline" onFinish={handleScoreSubmit} style={{ flexWrap: 'wrap', gap: 8 }}>
                <Form.Item name="supplier_id" rules={[{ required: true }]}>
                  <Select placeholder="Select supplier" style={{ width: 200 }}
                    onChange={(val) => {
                      const s = responses.responses.find(r => r.supplier_id === val);
                      setSelectedSupplier(s ? { id: s.supplier_id, name: s.supplier_name } : null);
                    }}>
                    {responses.responses.map(r => (
                      <Select.Option key={r.supplier_id} value={r.supplier_id}>{r.supplier_name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item name="criteria_name" rules={[{ required: true }]}>
                  <Select placeholder="Criteria" style={{ width: 200 }}>
                    {EVALUATION_CRITERIA.map(c => (
                      <Select.Option key={c} value={c}>{c}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item name="score" rules={[{ required: true }]}>
                  <InputNumber min={0} max={100} placeholder="Score (0-100)" style={{ width: 130 }} />
                </Form.Item>
                <Form.Item name="weight">
                  <InputNumber min={0} placeholder="Weight" defaultValue={1} style={{ width: 110 }} />
                </Form.Item>
                <Form.Item name="comments" style={{ minWidth: 200 }}>
                  <Input placeholder="Comments (optional)" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit">Save Score</Button>
                </Form.Item>
              </Form>
            </Card>
          ),
        },
        {
          key: 'responses',
          label: <span><FileTextOutlined /> Technical Responses</span>,
          children: (
            <Card title="Supplier Technical Submissions">
              {responses.responses.length > 0 ? (
                responses.responses.map(resp => (
                  <Card key={resp.id} size="small" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <Text strong style={{ fontSize: 15 }}>{resp.supplier_name}</Text>
                        <br />
                        <Text type="secondary">Submitted: {new Date(resp.submitted_at).toLocaleString()}</Text>
                      </div>
                      <Space>
                        <Button
                          type="primary"
                          icon={<TrophyOutlined />}
                          onClick={() => openAwardModal(resp.supplier_id, resp.supplier_name, resp.total_price)}
                        >
                          Award to {resp.supplier_name}
                        </Button>
                      </Space>
                    </div>
                    <Divider />
                    <Text strong>Product Specifications:</Text>
                    <p>{resp.product_specifications || 'No specifications provided'}</p>
                    {resp.response_file_path && (
                      <a href={resp.response_file_path} target="_blank" rel="noreferrer">
                        <FileTextOutlined /> View Attached Document
                      </a>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <Text strong>Total Bid Value: </Text>
                      <Text strong style={{ color: '#389e0d', fontSize: 16 }}>
                        ZMW {Number(resp.total_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </Text>
                    </div>
                  </Card>
                ))
              ) : (
                <Alert type="info" showIcon message="No supplier responses received yet." />
              )}
            </Card>
          ),
        },
      ]} />

      {/* Score Modal */}
      <Modal
        title={`Score Supplier: ${selectedSupplier?.name || ''}`}
        open={scoreModalVisible}
        onCancel={() => setScoreModalVisible(false)}
        footer={null}
      >
        <Form form={scoreForm} layout="vertical" onFinish={handleScoreSubmit}>
          <Form.Item name="criteria_name" label="Evaluation Criteria" rules={[{ required: true }]}>
            <Select placeholder="Select criteria">
              {EVALUATION_CRITERIA.map(c => (
                <Select.Option key={c} value={c}>{c}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="score" label="Score (0-100)" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={1}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="comments" label="Comments">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>Save Score</Button>
        </Form>
      </Modal>

      {/* Award Modal */}
      <Modal
        title={`Award Bid to: ${awardSupplier?.name || ''}`}
        open={awardModalVisible}
        onCancel={() => setAwardModalVisible(false)}
        footer={null}
        width={600}
      >
        <Alert
          type="success"
          showIcon
          message="Award Decision"
          description="Awarding this bid will create a purchase order and transition the bid to 'Awarded' status. The supplier will be notified."
          style={{ marginBottom: 16 }}
        />
        <Form form={awardForm} layout="vertical" onFinish={handleAwardSubmit}>
          <Form.Item name="supplier_id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="total_amount" label="Total Award Amount (ZMW)" rules={[{ required: true }]}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="contract_file_path" label="Contract Document (optional)">
            <Input placeholder="Path or URL to signed contract document" />
          </Form.Item>
          <Form.Item name="award_notes" label="Award Decision Notes">
            <Input.TextArea rows={3} placeholder="e.g. Awarded based on lowest compliant bid meeting all technical specifications" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={awarding} icon={<TrophyOutlined />} size="large">
            Confirm Award — Create Order
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
