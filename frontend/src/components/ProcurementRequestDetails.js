import React from 'react';
import { Descriptions, Tag, Typography } from 'antd';
import { parseLegacyRequestDescription } from '../utils/procurementRequestPrefill';

const { Paragraph, Text } = Typography;

function structuredRequirements(request) {
  if (request?.requirements && typeof request.requirements === 'object') return request.requirements;
  if (typeof request?.requirements === 'string') {
    try { return JSON.parse(request.requirements); } catch { /* use legacy copy */ }
  }
  return parseLegacyRequestDescription(request?.description);
}

function label(value) {
  return value ? String(value).replaceAll('_', ' ') : 'Not specified';
}

export default function ProcurementRequestDetails({ request }) {
  if (!request) return null;
  const requirements = structuredRequirements(request);

  return (
    <div className="procurement-request-details">
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Request" span={2}><Text strong>{request.title}</Text></Descriptions.Item>
        <Descriptions.Item label="Quantity">
          {requirements.quantity ? `${Number(requirements.quantity).toLocaleString()} ${label(requirements.unit_of_measure)}` : 'Not specified'}
        </Descriptions.Item>
        <Descriptions.Item label="Needed by">
          {request.required_delivery_date ? new Date(request.required_delivery_date).toLocaleDateString() : 'Flexible'}
        </Descriptions.Item>
        <Descriptions.Item label="Budget estimate">
          {request.estimated_budget ? `ZMW ${Number(request.estimated_budget).toLocaleString()}` : 'Not specified'}
        </Descriptions.Item>
        <Descriptions.Item label="Preferred payment"><Tag>{label(request.payment_method)}</Tag></Descriptions.Item>
        {requirements.business_category && (
          <Descriptions.Item label="Category" span={2}>{requirements.business_category}</Descriptions.Item>
        )}
        <Descriptions.Item label="Specifications" span={2}>
          <Paragraph className="request-detail-copy">{requirements.specification || request.description || 'Not provided'}</Paragraph>
        </Descriptions.Item>
        <Descriptions.Item label="Warranty and support" span={2}>
          <Paragraph className="request-detail-copy">{requirements.warranty || 'No specific warranty requirement'}</Paragraph>
        </Descriptions.Item>
        <Descriptions.Item label="Status"><Tag>{label(request.status)}</Tag></Descriptions.Item>
        <Descriptions.Item label="Submitted">
          {request.created_at ? new Date(request.created_at).toLocaleString() : 'Not available'}
        </Descriptions.Item>
        {request.admin_notes && (
          <Descriptions.Item label="Procurement note" span={2}>{request.admin_notes}</Descriptions.Item>
        )}
        {request.converted_bid_id && (
          <Descriptions.Item label="Generated bid" span={2}><Text code>{request.converted_bid_id}</Text></Descriptions.Item>
        )}
      </Descriptions>
    </div>
  );
}
