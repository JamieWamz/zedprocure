import React, { useState, useEffect, useRef } from 'react';
import { cdnImages } from '../cdnAssets';

const MIN_SPLASH_MS = 2000; // minimum time to show splash

export default function SplashScreen({ onFinish }) {
  const [progress, setProgress] = useState(0);
  const [currentBg, setCurrentBg] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const loadedRef = useRef(0);
  const startTime = useRef(Date.now());
  const readyRef = useRef(false);

  // Preload all background images
  useEffect(() => {
    let cancelled = false;
    const total = cdnImages.splash.length;

    cdnImages.splash.forEach((url, idx) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        loadedRef.current += 1;
        setProgress(Math.round((loadedRef.current / total) * 100));
        // Rotate background as each image loads
        setCurrentBg(idx);
      };
      img.onerror = () => {
        // Still count errored images as "loaded" so we don't hang
        if (cancelled) return;
        loadedRef.current += 1;
        setProgress(Math.round((loadedRef.current / total) * 100));
      };
      img.src = url;
    });

    return () => { cancelled = true; };
  }, []);

  // When all images loaded + minimum time elapsed, trigger fade-out
  useEffect(() => {
    if (readyRef.current) return;
    if (loadedRef.current < cdnImages.splash.length) return;

    const elapsed = Date.now() - startTime.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

    const timer = setTimeout(() => {
      readyRef.current = true;
      setFadeOut(true);
      // Wait for fade-out animation to complete before calling onFinish
      setTimeout(onFinish, 600);
    }, remaining);

    return () => clearTimeout(timer);
  }, [progress, onFinish]);

  return (
    <div className={`splash-root ${fadeOut ? 'splash-fade-out' : ''}`}>
      {/* Rotating background image */}
      <div
        className="splash-bg"
        style={{ backgroundImage: `url(${cdnImages.splash[currentBg]})` }}
      />

      {/* Overlay */}
      <div className="splash-overlay" />

      {/* Content */}
      <div className="splash-content">
        <div className="splash-brand">
          <div className="splash-logo" />
          <span className="splash-name">Freshstart</span>
        </div>

        <div className="splash-tagline">
          <h1>Zambia Procurement Portal</h1>
          <p>Transparent, multi-tenant public procurement</p>
        </div>

        <div className="splash-loader">
          <div className="splash-progress-track">
            <div
              className="splash-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="splash-progress-text">
            {progress < 100 ? `Loading assets\u2026 ${progress}%` : 'Initializing\u2026'}
          </span>
        </div>

        <div className="splash-footer">
          <span>Secured with JWT \u00B7 Role-based access</span>
        </div>
      </div>
    </div>
  );
}
