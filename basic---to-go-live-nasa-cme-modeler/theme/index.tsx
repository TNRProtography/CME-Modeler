import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { ThemeTokens, baseTheme } from './tokens';

interface ThemeContextValue {
  theme: ThemeTokens;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: baseTheme });

export const ThemeProvider = ({ value, children }: { value?: ThemeTokens; children: ReactNode }) => {
  const mergedTheme = useMemo(() => ({ ...baseTheme, ...value }), [value]);
  return <ThemeContext.Provider value={{ theme: mergedTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);

export const focusStyle = (theme: ThemeTokens) => ({
  outline: `2px solid ${theme.colors.focus}`,
  outlineOffset: '2px'
});

export { baseTheme };
