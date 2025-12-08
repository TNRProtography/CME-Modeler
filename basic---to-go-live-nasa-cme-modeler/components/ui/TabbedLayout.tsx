import React, { ReactNode, useState } from 'react';
import { useTheme, focusStyle } from '../../theme';

interface TabConfig {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabbedLayoutProps {
  tabs: TabConfig[];
  ariaLabel?: string;
}

const TabbedLayout: React.FC<TabbedLayoutProps> = ({ tabs, ariaLabel }) => {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState(tabs[0]?.id);

  return (
    <div role="tablist" aria-label={ariaLabel} style={{ fontFamily: theme.typography.fontFamily }}>
      <div style={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const currentIndex = tabs.findIndex((t) => t.id === activeTab);
                const nextIndex = e.key === 'ArrowRight' ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
                setActiveTab(tabs[nextIndex].id);
              }
            }}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.md}`,
              background: tab.id === activeTab ? theme.colors.primary : theme.colors.surfaceMuted,
              color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              cursor: 'pointer',
              ...focusStyle(theme)
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ border: `1px solid ${theme.colors.border}`, borderRadius: theme.radii.md, padding: theme.spacing.md }}>
        {tabs.find((tab) => tab.id === activeTab)?.content}
      </div>
    </div>
  );
};

export default TabbedLayout;
