import React from 'react';
import { Steps } from 'antd';

const { Step } = Steps;

const ProgressSteps = ({ steps, current }) => {
  return (
    <Steps current={current} size="small">
      {steps.map(item => (
        <Step key={item.title} title={item.title} description={item.description} />
      ))}
    </Steps>
  );
};

export default ProgressSteps;
