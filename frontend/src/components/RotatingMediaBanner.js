import React, { useEffect, useMemo, useState } from 'react';

const ROTATION_INTERVAL_MS = 8000;

export default function RotatingMediaBanner({
  images,
  children,
  className = '',
  imagePosition = 'center',
  ariaLabel,
}) {
  const sources = useMemo(() => (images || []).filter(Boolean), [images]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    sources.forEach((src) => {
      const image = new Image();
      image.src = src;
    });

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (sources.length < 2 || reduceMotion) return undefined;

    const interval = window.setInterval(() => {
      setActiveIndex(index => (index + 1) % sources.length);
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [sources]);

  useEffect(() => {
    if (activeIndex >= sources.length) setActiveIndex(0);
  }, [activeIndex, sources.length]);

  const advanceImage = () => {
    if (sources.length > 1) setActiveIndex(index => (index + 1) % sources.length);
  };

  return (
    <section className={`page-media-banner page-media-banner--image ${className}`.trim()} aria-label={ariaLabel}>
      {sources.length > 0 && (
        <img
          key={sources[activeIndex]}
          className="page-media-banner-image"
          src={sources[activeIndex]}
          alt=""
          aria-hidden="true"
          style={{ objectPosition: imagePosition }}
          onError={advanceImage}
        />
      )}
      <span className="page-media-banner-scrim" aria-hidden="true" />
      {children}
      {sources.length > 1 && (
        <span className="page-media-banner-dots" aria-hidden="true">
          {sources.map((src, index) => (
            <span key={src} className={index === activeIndex ? 'is-active' : ''} />
          ))}
        </span>
      )}
    </section>
  );
}
