import React, { useEffect, useState } from 'react';
import { Table, Button, message } from 'antd';
import axios from 'axios';

export default function SupplierVerification() {
  const [suppliers, setSuppliers] = useState([]);
  const fetch = async () => {
    const { data } = await axios.get('/api/admin/suppliers/pending');
    setSuppliers(data);
  };
  useEffect(() => { fetch(); }, []);
  const handleVerify = async (id, status) => {
    await axios.put(`/api/admin/suppliers/${id}/verify`, { status });
    message.success(`Supplier ${status}`);
    fetch();
  };
  const columns = [
    { title: 'Company', dataIndex: 'company_name' },
    { title: 'Reg No.', dataIndex: 'registration_number' },
    { title: 'Status', dataIndex: 'verification_status' },
    { title: 'Documents', dataIndex: 'documents', render: docs => docs?.map(d => <div key={d.id}>{d.type}: <a href={d.path} target="_blank" rel="noreferrer">View</a></div>) },
    { title: 'Action', render: (_, record) => (
        <><Button type="primary" size="small" onClick={() => handleVerify(record.id, 'verified')}>Verify</Button>
         <Button danger size="small" onClick={() => handleVerify(record.id, 'rejected')} style={{ marginLeft: 8 }}>Reject</Button></>
    )}
  ];
  return <div><h2>Supplier Verification</h2><Table dataSource={suppliers} rowKey="id" columns={columns} /></div>;
}
