import React from 'react';
import { Card, Statistic } from 'antd';
import { useNavigate } from 'react-router-dom';

const DashboardStatistic = ({ title, value, prefix, color, path }) => {
  const navigate = useNavigate();

  return (
    <Card hoverable={!!path} onClick={() => path && navigate(path)}>
      <Statistic
        title={title}
        value={value}
        prefix={prefix}
        valueStyle={{ color: color || '#1677ff' }}
      />
    </Card>
  );
};

export default DashboardStatistic;
