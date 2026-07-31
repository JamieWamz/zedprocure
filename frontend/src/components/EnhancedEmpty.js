import React from 'react';
import { Empty, Button, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const EnhancedEmpty = ({ title, description, ctaText, ctaPath, icon }) => {
  const navigate = useNavigate();

  return (
    <Empty
      className="enhanced-empty"
      image={icon || Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div>
          <Typography.Title level={5}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      }
    >
      {ctaText && ctaPath && (
        <Button type="primary" onClick={() => navigate(ctaPath)}>
          {ctaText} <ArrowRightOutlined />
        </Button>
      )}
    </Empty>
  );
};

export default EnhancedEmpty;
