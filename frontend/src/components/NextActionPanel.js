import React from 'react';
import { Button, Space, Typography } from 'antd';
import { ArrowRightOutlined, CompassOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export default function NextActionPanel({
  eyebrow = 'Recommended next step',
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  secondaryLabel,
  onSecondary,
  compact = false,
}) {
  return (
    <section className={`next-action-panel${compact ? ' next-action-panel--compact' : ''}`} aria-labelledby="next-action-title">
      <div className="next-action-icon" aria-hidden="true"><CompassOutlined /></div>
      <div className="next-action-copy">
        <Text className="next-action-eyebrow">{eyebrow}</Text>
        <Title level={4} id="next-action-title">{title}</Title>
        {description && <Text type="secondary">{description}</Text>}
      </div>
      {(actionLabel || secondaryLabel) && (
        <Space className="next-action-buttons" wrap>
          {secondaryLabel && <Button onClick={onSecondary}>{secondaryLabel}</Button>}
          {actionLabel && (
            <Button type="primary" onClick={onAction} icon={actionIcon}>
              {actionLabel} {!actionIcon && <ArrowRightOutlined />}
            </Button>
          )}
        </Space>
      )}
    </section>
  );
}
