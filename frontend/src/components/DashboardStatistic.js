import React from 'react';
import { Card, Statistic } from 'antd';
import { useNavigate } from 'react-router-dom';
import { isActivationKey } from '../utils/notificationNavigation';

const DashboardStatistic = ({ title, value, prefix, color, path }) => {
  const navigate = useNavigate();

  return (
    <Card
      className={path ? 'stat-card stat-card--interactive' : 'stat-card'}
      hoverable={!!path}
      role={path ? 'button' : undefined}
      tabIndex={path ? 0 : undefined}
      onClick={() => path && navigate(path)}
      onKeyDown={(event) => {
        if (path && isActivationKey(event)) {
          event.preventDefault();
          navigate(path);
        }
      }}
    >
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
