import React from 'react';
import { Steps, Typography } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

const ProgressSteps = ({ steps, current = 0, showNext = true }) => {
  const safeCurrent = Math.max(0, Math.min(current, Math.max(steps.length - 1, 0)));
  const complete = safeCurrent >= steps.length - 1;
  const nextStep = steps[Math.min(safeCurrent + 1, steps.length - 1)];

  return (
    <div className="workflow-progress">
      <Steps current={safeCurrent} size="small" responsive items={steps} />
      {showNext && nextStep && (
        <div className={`workflow-progress-next${complete ? ' workflow-progress-next--complete' : ''}`}>
          {complete ? <CheckCircleOutlined /> : <ArrowRightOutlined />}
          <div>
            <Text strong>{complete ? 'Workflow stage complete' : `Up next: ${nextStep.title}`}</Text>
            <Text type="secondary">{complete ? 'Review the completed record and continue from the available actions.' : nextStep.description}</Text>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProgressSteps;
