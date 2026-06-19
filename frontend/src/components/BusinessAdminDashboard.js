import React from 'react';
import { Card, Button } from 'antd';
import { Link } from 'react-router-dom';

export default function BusinessAdminDashboard() {
  return (
    <div style={{ padding:24 }}>
      <h2>Business Administration</h2>
      <Card title="Supplier Verification" style={{ marginBottom:16 }}>
        <Link to="/admin-dashboard/verification"><Button type="primary">Go to Verification Queue</Button></Link>
      </Card>
      <Card title="Financial Ledger">
        <Link to="/admin-dashboard/ledger"><Button type="primary">Open Ledger</Button></Link>
      </Card>
    </div>
  );
}
