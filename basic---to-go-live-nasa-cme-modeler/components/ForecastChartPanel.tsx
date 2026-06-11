// --- START OF FILE src/components/ForecastChartPanel.tsx ---

import React from 'react';

// ---- Satellite mission logos (base64-encoded thumbnails) ----
const SATELLITE_LOGOS: Record<string, string> = {
  SOLAR1: 'data:image/jpeg;base64,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',
  ACE: 'data:image/jpeg;base64,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',
  IMAP: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAA8AEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7LoorL8Xa5ZeG/DGpa9qDBbWwtnuJOcZCjOB7k4H400m3ZCbsrs8e/af+Mk3gm3Twx4ZlT/hILuMPLNgN9iiPAIHQyN/CD0HOOmfANE+CXxY8Wo2sy6NLGbo+aZ9VuhFLKTzuIbL8+pAr1v4Y+HYNJtpvjL8Q7cXvibW5mutLsZRxAG5VsHoduMH+BQuOTV+78U+K/Emrx241OeB5n2xwQOYkXgnHHJ47nNZ4/iKhlDWHpR5p9f6/I6sv4dr5tF15y5YLa/8AX3niN94M+LXwe1GLxKtld6cICM3tnIs8GM/dl28bT6OAPxr64+BnxKsfiV4SGoJGltqlqRFqNqpyI5McMvcow5H4jqK878MeP9b01/Jv5ZNV06QbZoLk722Hg4Y/yOQelZdxpFl8KfiVo3xH8JMB4H8QSrY6pbpwtkZGwrY7IH5A/hIZejCqwOeYfO4NJctRfiRmGR4jJppyd4PqfTFFA6UUzEK4T4saZ/wk02heD5QTYX16LvUx/C1pbYkZD7NIYVPsTXd1yXxRuBpnhXUdThRvtb24tEcDOxXYAn26/oKipiFhoSrP7Kb+5GlGg8RUjSX2ml955F4z1U+K/FM8qXlpbWkP7m0E8mxBGD1HB6nn8vSu5+GXh61uzDeX95pl/caa4+zz2VxvcKVYbJeBkDPy9x0zgV5Lp1r9quREZo7eIDdJLJ92NR1J7n2A5JwK7fwR4j8rxbpOlaSJLTSElYMp/wBZcsUb95KR1PTC9F4r8/y7FQlivbYhXcn+Lfbsv+GP0XM8JOOE9hh3ZRX3JLv3fb5sf4+8N2+mSLpOn6po1lZxgSNFPdEXEzkfek+XkDoo6D8apeBlsdYtNX+Hmtyxz6XrUDxo0bbgku37yn14BH+0orNfWl8QWgs9dm/0tM/Y9RfquTny5T3Q9m6qfbNYkEtxpmoxzrmO4tZQ456Mpz1H0qPr0aGLjiqCsk/uXa3TyLWXzr4OeFxDvK349Hfr59eh9D/DK5v7jwRpserEHUrSM2d6c/emhYxO3/Aim4ezCukqnpKwtai7hiMX2vFwykYIZlGePXgVcr9HclJ8y6n5nyuOj6BUV1bw3VvJb3ESSwyKVdHGQwPUEVgT+NtCh+IMHgV5Lj+2Z7M3qIIT5flDPO/pn5TxWB4u+MngTwp4xHhbXtRuLO+xGWdrZjCgkGVJccAep7d6pUZz0Ub/AORLqxjrexleJvhIHmefw/epEpORbXOSF9lcc/mD9a5eDwH420u/iurfS1kkibcjRzowzgj1B717nquq6dpWkXGr6jdxW1hbRGaad2+VUAyTn/Oa5P4a/FXwh8Qr69s/DVxdzSWUayS+datENrMQMFuvINeFV4aw1VurBONu2362Pfo8T4ulH2U2pX77/g1c82sPhn4uuGVXsYbVem6adePwXJrvvBnwv0/SbiO91aZdQuUIZIwmIUI74PLH68e1bfxF+IHhTwBp8V74m1NbQTsVgiVDJLKR12qvOBnk9Bkc81a8C+MPDvjbRBrHhvUY7213bHIBV43AyVZTyp5HX61WF4cw2HtV5XLze3+ROL4lxeJTpcyjfot/8zfFFeaeO/jf4C8FeJrjw9rt3fR38CI8ixWbSKA67hyPY10fw++IHhLx5ZS3XhfV4r3ycCaLaUliz03IwBAPOD0OOte46NSMedxdjwVVg5cqep5pq3/J5+kf9ixJ/wChSVj6x4a0rxd+1P4s8P61biazu/CsaNwN0bZi2up7MDyDXr9x4G0ab4mW/j55bwarb2JsUQSDyfLOTkrjO75jzmnWngbRrf4l3fj6OW8OrXVktjIhkHkiMbSCFxnPyjnNdSrKOq/lt+Jzulff+Y8Psvhz8V9di034X+LJUXwTpFz5k2qRTDzNQt0OYYcZ3DHTBA28ddq53/gpaWun/tH/ABNsbG3itra3hs44Yo1CqihFAAA6V73iuT8P+BtG0Pxzr3i+zlvG1DXBGLpZJAYhsAA2DAI6dyaX1lzjJNdOne61H7BRlFrv+jPKfBWn2nxK/aN8XeI9Zgiv9L8LhdL06CZQ8YlyQzbTwSCsh+rA9hTtCtYfht+1O2iadHHaaH4x08zx28fyxx3Me4naOg5VuB/z0x6V6p8N/Ami+BbTUoNHkvJjqV697cSXUgdzIw5wQBx7e5o8YeBNF8TeKPDviO+kvIr/AECdprRoJAqsSVJVwQcr8vQY6mqdZe0cPs2t+H+eolSfKpdb3/H/ACOU+IXxm8A+EfFtz4e1uw1KfUII43kMGniVSHUMvzZz0Nch8GoZ/Fvx31P4i6B4cvPD3hg6b9kJuIBAb+YkfOEHHbJIz90c5Jr1qx8DaNafEu/8exSXh1W+s1s5UaQGERrtwQuMg/IOc+tdWBWTqwpx5YLVrv8AoWoSnK8nomf/2Q==',
};

const SATELLITE_DISPLAY: Record<string, { label: string; borderColor: string; bgColor: string; textColor: string; glowBorder: string; glowBg: string }> = {
  SOLAR1: { label: 'SOLAR-1', borderColor: 'border-amber-400/50', bgColor: 'bg-amber-500/10', textColor: 'text-amber-200', glowBorder: 'border-amber-400/30', glowBg: 'from-amber-500/10' },
  ACE:    { label: 'ACE',     borderColor: 'border-rose-400/50',  bgColor: 'bg-rose-500/10',  textColor: 'text-rose-200',  glowBorder: 'border-rose-400/30',  glowBg: 'from-rose-500/10' },
  IMAP:   { label: 'IMAP',    borderColor: 'border-sky-400/50',   bgColor: 'bg-sky-500/10',   textColor: 'text-sky-200',   glowBorder: 'border-sky-400/30',   glowBg: 'from-sky-500/10' },
  DSCOVR: { label: 'DSCOVR',  borderColor: 'border-emerald-400/50', bgColor: 'bg-emerald-500/10', textColor: 'text-emerald-200', glowBorder: 'border-emerald-400/30', glowBg: 'from-emerald-500/10' },
};

const SatelliteBadge: React.FC<{ satellite: string }> = ({ satellite }) => {
  const config = SATELLITE_DISPLAY[satellite];
  if (!config) return null;
  const logo = SATELLITE_LOGOS[satellite];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${config.borderColor} ${config.bgColor} px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config.textColor}`}>
      {logo ? (
        <img src={logo} alt={config.label} className="h-4 w-4 rounded-full object-cover" />
      ) : null}
      {config.label}
    </span>
  );
};

interface ForecastChartPanelProps {
  title: string;
  currentValue: string; // HTML string for value + units
  emoji: string;
  onOpenModal: () => void;
  children: React.ReactNode;
  /** @deprecated use satellite instead */
  isImap?: boolean;
  satellite?: string;
  lastDataReceived?: string;
}

const ForecastChartPanel: React.FC<ForecastChartPanelProps> = ({
  title,
  currentValue,
  emoji,
  onOpenModal,
  children,
  isImap = false,
  satellite,
  lastDataReceived,
}) => {
  // Determine the active satellite key. Prefer the explicit prop; fall back to legacy isImap.
  const satKey = satellite && satellite !== '—' ? satellite : (isImap ? 'IMAP' : null);
  const satConfig = satKey ? SATELLITE_DISPLAY[satKey] : null;
  const hasSatHighlight = !!satConfig;

  return (
    <div
      className={`col-span-12 card bg-neutral-950/80 p-4 flex flex-col ${
        hasSatHighlight ? `border ${satConfig!.glowBorder} bg-gradient-to-br ${satConfig!.glowBg} via-transparent to-transparent` : ''
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold text-white">{title}</h3>
            <button
              onClick={onOpenModal}
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
              title={`About ${title}`}
            >
              ?
            </button>
          </div>
          {satKey && (
            <div>
              <SatelliteBadge satellite={satKey} />
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white" dangerouslySetInnerHTML={{ __html: currentValue }}></div>
          <div className="text-2xl mt-1">{emoji}</div>
          {lastDataReceived && (
            <div className="text-[11px] text-neutral-400 mt-1">
              Last updated: {lastDataReceived}
            </div>
          )}
        </div>
      </div>
      <div className="flex-grow w-full">
        {children}
      </div>
    </div>
  );
};

export default ForecastChartPanel;
// --- END OF FILE src/components/ForecastChartPanel.tsx ---