import React, { useState, useEffect } from 'react';
import { Card, List, Button, message, Select } from 'antd';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function SupplierDashboard() {
  const [invitations, setInvitations] = useState([]);
  const [docFile, setDocFile] = useState(null);
  const [docType, setDocType] = useState('tax_clearance');
  const [uploading, setUploading] = useState(false);

  const fetchInvitations = async () => {
    try {
      const { data } = await axios.get('/api/supplier/bids');
      setInvitations(data);
    } catch { message.error('Failed to load invitations'); }
  };
  useEffect(() => { fetchInvitations(); }, []);

  const handleUploadDoc = async () => {
    if (!docFile) return message.error('Select a file');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('document_type', docType);
      formData.append('file', docFile);

      await axios.post('/api/supplier/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('Document submitted for verification');
      setDocFile(null);
    } catch { message.error('Upload failed'); }
    finally { setUploading(false); }
  };

  const handleAccept = async (bidSupplierId, accepted) => {
    try {
      await axios.post(`/api/supplier/bids/${bidSupplierId}/respond`, { accepted });
      message.success(accepted ? 'Accepted' : 'Rejected');
      fetchInvitations();
    } catch { message.error('Action failed'); }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Supplier Portal</h2>
      <Card title="Upload Compliance Document" style={{ marginBottom: 20 }}>
        <Select value={docType} onChange={setDocType} style={{ width: 220, marginRight: 12 }}>
          <Select.Option value="tax_clearance">Tax Clearance</Select.Option>
          <Select.Option value="ppda_registration">PPDA Registration</Select.Option>
          <Select.Option value="company_certificate">Company Certificate</Select.Option>
        </Select>
        <input type="file" onChange={e => setDocFile(e.target.files[0])} />
        <Button onClick={handleUploadDoc} loading={uploading} style={{ marginLeft: 12 }}>Submit for Verification</Button>
      </Card>
      <Card title="Open Invitations">
        <List dataSource={invitations} locale={{ emptyText: 'No open invitations' }} renderItem={item => (
          <List.Item actions={[
            <Button type="primary" size="small" onClick={() => handleAccept(item.bid_supplier_id, true)}>Accept</Button>,
            <Button danger size="small" onClick={() => handleAccept(item.bid_supplier_id, false)}>Reject</Button>,
            <Link to={`/supplier/bids/${item.id}`}><Button type="link" size="small">View Details</Button></Link>
          ]}>
            <List.Item.Meta title={item.title} description={`Deadline: ${new Date(item.deadline).toLocaleString()}`} />
          </List.Item>
        )} />
      </Card>
    </div>
  );
}