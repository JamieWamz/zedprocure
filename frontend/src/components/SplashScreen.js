import React from 'react';

export default function SplashScreen() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label="Loading workspace">
      <div className="route-loading-content">
        <div className="route-loading-mark" aria-hidden="true" />
        <h1>Freshstart Procurement</h1>
        <p>Loading your workspace…</p>
      </div>
    </div>
  );
}
