import React from 'react';
import { Steps, Tag } from 'antd';
import {
  FileTextOutlined, SendOutlined, AuditOutlined,
  ShoppingCartOutlined, CheckCircleOutlined
} from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';

const STAGES = {
  customer: [
    { title: 'Requirements', description: 'Submit your procurement needs', icon: <FileTextOutlined /> },
    { title: 'Bid Evaluation', description: 'Suppliers review & quote', icon: <AuditOutlined /> },
    { title: 'Awarding', description: 'Select winning supplier', icon: <CheckCircleOutlined /> },
    { title: 'Order & Escrow', description: 'Fund & fulfill order', icon: <ShoppingCartOutlined /> },
    { title: 'Completion', description: 'Delivery & payment release', icon: <CheckCircleOutlined /> },
  ],
  supplier: [
    { title: 'Invitation', description: 'Bid opportunities', icon: <FileTextOutlined /> },
    { title: 'Response', description: 'Submit your quote', icon: <SendOutlined /> },
    { title: 'Evaluation', description: 'Under review', icon: <AuditOutlined /> },
    { title: 'Awarded', description: 'Contract won', icon: <CheckCircleOutlined /> },
    { title: 'Fulfillment', description: 'Deliver & get paid', icon: <ShoppingCartOutlined /> },
  ],
};

export default function ProcurementStageIndicator({ role = 'customer', currentStage = 0, bidStatus }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const stages = STAGES[role] || STAGES.customer;

  const statusColor = {
    draft: 'default',
    open: 'processing',
    evaluation: 'warning',
    awarded: 'success',
    completed: 'success',
    cancelled: 'error',
  };

  return (
    <div style={{
      background: isDark ? '#1f1f1f' : '#fff',
      borderRadius: 12,
      padding: '24px 16px 16px',
      marginBottom: 20,
      border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
      boxShadow: isDark
        ? '0 2px 8px rgba(0,0,0,0.3)'
        : '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: isDark ? '#e8e8e8' : '#262626' }}>
          Procurement Progress
        </h3>
        {bidStatus && (
          <Tag color={statusColor[bidStatus] || 'default'} style={{ textTransform: 'capitalize' }}>
            {bidStatus?.replace('_', ' ')}
          </Tag>
        )}
      </div>
      <Steps
        current={currentStage}
        size="small"
        labelPlacement="vertical"
        items={stages.map((s, i) => ({
          title: <span style={{ fontSize: 12, fontWeight: i === currentStage ? 600 : 400, color: isDark ? '#d9d9d9' : undefined }}>{s.title}</span>,
          description: <span style={{ fontSize: 11, color: isDark ? '#8c8c8c' : '#8c8c8c' }}>{s.description}</span>,
          icon: s.icon,
          status: i < currentStage ? 'finish' : i === currentStage ? 'process' : 'wait',
        }))}
      />
    </div>
  );
}