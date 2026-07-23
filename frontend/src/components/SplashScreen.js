import React, { useState, useEffect, useRef } from 'react';
import { cdnImages } from '../cdnAssets';

const MIN_SPLASH_MS = 1500; // minimum time to show splash

export default function SplashScreen({ onFinish, isRouteLoading = false }) {
  const [progress, setProgress] = useState(isRouteLoading ? 75 : 0);
  const [currentBg, setCurrentBg] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const loadedRef = useRef(0);
  const startTime = useRef(Date.now());
  const readyRef = useRef(false);

  // Preload all background images
  useEffect(() => {
    let cancelled = false;
    const total = cdnImages.splash.length;

    // Hard safety timer: guarantee splash screen progresses and completes within 1.8s
    const hardSafetyTimer = setTimeout(() => {
      if (!cancelled && loadedRef.current < total) {
        loadedRef.current = total;
        setProgress(100);
      }
    }, 1800);

    cdnImages.splash.forEach((url, idx) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        loadedRef.current += 1;
        setProgress(Math.round((loadedRef.current / total) * 100));
        setCurrentBg(idx);
      };
      img.onerror = () => {
        if (cancelled) return;
        loadedRef.current += 1;
        setProgress(Math.round((loadedRef.current / total) * 100));
      };
      img.src = url;
    });

    return () => {
      cancelled = true;
      clearTimeout(hardSafetyTimer);
    };
  }, []);

  // When all images loaded + minimum time elapsed, trigger fade-out
  useEffect(() => {
    if (isRouteLoading) return;
    if (readyRef.current) return;
    if (loadedRef.current < cdnImages.splash.length) return;

    const elapsed = Date.now() - startTime.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);

    const timer = setTimeout(() => {
      readyRef.current = true;
      setFadeOut(true);
      if (onFinish) {
        setTimeout(onFinish, 500);
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, [progress, onFinish, isRouteLoading]);

  const activeBgUrl = cdnImages.splash[currentBg] || cdnImages.loginHero;

  return (
    <div className={`splash-root ${fadeOut ? 'splash-fade-out' : ''}`}>
      {/* Rotating background image */}
      <div
        className="splash-bg"
        style={{ backgroundImage: `url(${activeBgUrl})` }}
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
          <p>{isRouteLoading ? 'Preparing your secure workspace...' : 'Transparent, multi-tenant public procurement'}</p>
        </div>

        <div className="splash-loader">
          <div className="splash-progress-track">
            <div
              className="splash-progress-fill"
              style={{ width: `${isRouteLoading ? 100 : progress}%` }}
            />
          </div>
          <span className="splash-progress-text">
            {isRouteLoading
              ? 'Authenticating & loading environment\u2026'
              : progress < 100
                ? `Loading assets\u2026 ${progress}%`
                : 'Initializing\u2026'}
          </span>
          {isRouteLoading && (
            <div className="route-loading-dots">
              <span /><span /><span />
            </div>
          )}
        </div>

        <div className="splash-footer">
          <span>Secured with JWT \u00B7 Role-based access</span>
        </div>
      </div>
    </div>
  );
}

