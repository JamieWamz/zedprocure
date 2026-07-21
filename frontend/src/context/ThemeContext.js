import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

const ThemeContext = createContext();
const STORAGE_KEY = 'zedprocure-appearance';

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [appearance, setAppearanceState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'system');
  const [resolvedTheme, setResolvedTheme] = useState(() => systemTheme());

  useEffect(() => {
    const update = () => setResolvedTheme(appearance === 'system' ? systemTheme() : appearance);
    update();
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, [appearance]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setAppearance = useCallback((value) => {
    setAppearanceState(value);
    localStorage.setItem(STORAGE_KEY, value);
  }, []);
  const value = useMemo(() => ({ appearance, resolvedTheme, setAppearance }), [appearance, resolvedTheme, setAppearance]);

  return <ThemeContext.Provider value={value}><ConfigProvider theme={{ algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}>{children}</ConfigProvider></ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
