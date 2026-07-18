import React from 'react';
import { Empty, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

const EnhancedEmpty = ({ title, description, ctaText, ctaPath, icon }) => {
  const navigate = useNavigate();

  return (
    <Empty
      image={icon || Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      }
    >
      {ctaText && ctaPath && (
        <Button type="primary" onClick={() => navigate(ctaPath)}>
          {ctaText}
        </Button>
      )}
    </Empty>
  );
};

export default EnhancedEmpty;
