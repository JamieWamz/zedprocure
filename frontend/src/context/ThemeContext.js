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

  const themeToken = useMemo(() => {
    const isDark = resolvedTheme === 'dark';
    return {
      colorPrimary: isDark ? '#45b7a6' : '#0f6b5d',
      colorInfo: isDark ? '#6aa8d7' : '#276b9a',
      colorSuccess: isDark ? '#68b984' : '#267343',
      colorWarning: isDark ? '#d6a24a' : '#9a650e',
      colorError: isDark ? '#e47b7b' : '#b4232d',
      colorBgBase: isDark ? '#10151b' : '#f5f7f9',
      colorTextBase: isDark ? '#edf1f4' : '#17212b',
      colorBorder: isDark ? '#303b46' : '#dbe1e7',
      colorBgContainer: isDark ? '#171e26' : '#ffffff',
      colorBgLayout: isDark ? '#10151b' : '#f5f7f9',
      colorTextSecondary: isDark ? '#9ba7b4' : '#52606d',
      borderRadius: 6,
      borderRadiusLG: 9,
      controlHeight: 40,
      controlHeightLG: 44,
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadowSecondary: isDark
        ? '0 8px 22px rgba(0, 0, 0, 0.32)'
        : '0 8px 22px rgba(16, 24, 40, 0.11)',
    };
  }, [resolvedTheme]);

  return <ThemeContext.Provider value={value}>
      <ConfigProvider theme={{
        algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: themeToken,
        components: {
          Button: { fontWeight: 600, primaryShadow: 'none' },
          Card: { headerFontSize: 15, headerHeight: 50, bodyPadding: 20 },
          Table: {
            headerBg: resolvedTheme === 'dark' ? '#1c252e' : '#f6f8fa',
            headerColor: resolvedTheme === 'dark' ? '#cbd3db' : '#3f4b57',
            headerBorderRadius: 0,
            cellPaddingBlock: 12,
            cellPaddingInline: 14,
            rowHoverBg: resolvedTheme === 'dark' ? '#1c252e' : '#f8fafb',
          },
          Tabs: { titleFontSize: 13, horizontalItemGutter: 24 },
          Modal: { titleFontSize: 17 },
        },
      }}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
