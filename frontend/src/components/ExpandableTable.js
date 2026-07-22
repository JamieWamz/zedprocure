import React, { useState } from 'react';
import { Modal, Button, Table, Tooltip } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';

/**
 * ExpandableTable — wraps an Ant Design Table with a fullscreen toggle.
 *
 * Usage: replace <Table ... /> with <ExpandableTable ... /> (all Table props pass through).
 * The fullscreen button appears in the top-right corner of the card/container.
 */
export default function ExpandableTable(props) {
  const [fullscreen, setFullscreen] = useState(false);

  const { title, ...tableProps } = props;

  const toggleFullscreen = () => setFullscreen(prev => !prev);

  const tableEl = (
    <Table
      {...tableProps}
      size={tableProps.size || (fullscreen ? 'middle' : 'small')}
    />
  );

  return (
    <>
      {/* Inline table with expand button */}
      <div style={{ position: 'relative' }}>
        {title && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
            <Tooltip title="Expand table">
              <Button
                type="text"
                icon={<FullscreenOutlined />}
                onClick={toggleFullscreen}
                size="small"
                aria-label="Expand table to fullscreen"
              />
            </Tooltip>
          </div>
        )}
        {tableEl}
      </div>

      {/* Fullscreen modal */}
      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{title || 'Table View'}</span>
            <Button
              type="text"
              icon={<FullscreenExitOutlined />}
              onClick={toggleFullscreen}
              size="small"
            >
              Exit Fullscreen
            </Button>
          </div>
        }
        open={fullscreen}
        onCancel={toggleFullscreen}
        footer={null}
        width="95vw"
        styles={{ body: { maxHeight: '85vh', overflow: 'auto', padding: 0 } }}
        destroyOnClose
      >
        <Table
          {...tableProps}
          size="middle"
          pagination={tableProps.pagination !== false ? { ...(tableProps.pagination || {}), pageSize: tableProps.pagination?.pageSize || 20, showSizeChanger: true } : false}
          scroll={{ x: 'max-content', y: 'calc(85vh - 200px)' }}
        />
      </Modal>
    </>
  );
}