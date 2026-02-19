import React, { useEffect, useMemo, useState } from 'react';
import GuideIcon from './icons/GuideIcon';

type DisturbanceView = 'historic' | 'kyoto';

interface HistoricStorm {
  date: string;
  dst: number;
  ap: number;
  kp: string;
}

interface KyotoDstRow {
  timestamp: string;
  dst: number;
}

const HISTORIC_STORMS: HistoricStorm[] = [
  { date: '1989/03/14', dst: -589, ap: 158, kp: '9' },
  { date: '1989/03/13', dst: -472, ap: 246, kp: '9' },
  { date: '1959/07/15', dst: -429, ap: 236, kp: '9' },
  { date: '1957/09/13', dst: -427, ap: 160, kp: '9-' },
  { date: '1958/02/11', dst: -426, ap: 199, kp: '9' },
  { date: '2003/11/20', dst: -422, ap: 150, kp: '9-' },
  { date: '2024/05/11', dst: -412, ap: 271, kp: '9' },
  { date: '1967/05/26', dst: -387, ap: 146, kp: '9-' },
  { date: '2001/03/31', dst: -387, ap: 192, kp: '9-' },
  { date: '2003/10/30', dst: -383, ap: 191, kp: '9' },
];

const KYOTO_DST_URL = 'https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json';

const DisturbanceIndexPanel: React.FC = () => {
  const [activeView, setActiveView] = useState<DisturbanceView>('historic');
  const [kyotoRows, setKyotoRows] = useState<KyotoDstRow[]>([]);
  const [isLoadingKyoto, setIsLoadingKyoto] = useState(false);
  const [kyotoError, setKyotoError] = useState<string | null>(null);

  useEffect(() => {
    if (activeView !== 'kyoto') return;
    let isMounted = true;

    const fetchKyotoDst = async () => {
      setIsLoadingKyoto(true);
      setKyotoError(null);
      try {
        const response = await fetch(`${KYOTO_DST_URL}?_=${Date.now()}`);
        if (!response.ok) {
          throw new Error(`Kyoto Dst feed returned ${response.status}`);
        }
        const data = await response.json();
        const normalized = (Array.isArray(data) ? data : [])
          .map((item: any) => {
            const timestamp = typeof item?.time_tag === 'string' ? item.time_tag : null;
            const dst = Number(item?.dst);
            if (!timestamp || !Number.isFinite(dst)) return null;
            return { timestamp, dst };
          })
          .filter((item: KyotoDstRow | null): item is KyotoDstRow => item !== null)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 48);

        if (isMounted) setKyotoRows(normalized);
      } catch {
        if (isMounted) setKyotoError('Unable to load Kyoto Dst feed right now.');
      } finally {
        if (isMounted) setIsLoadingKyoto(false);
      }
    };

    fetchKyotoDst();
    return () => {
      isMounted = false;
    };
  }, [activeView]);

  const kyotoUpdatedLabel = useMemo(() => {
    if (!kyotoRows.length) return '—';
    const latest = new Date(kyotoRows[0].timestamp);
    return Number.isFinite(latest.getTime()) ? latest.toLocaleString('en-NZ') : '—';
  }, [kyotoRows]);

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Geomagnetic Disturbance Index</h3>
          <button
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
            title="Dst estimates ring current strength. Lower (more negative) values indicate stronger geomagnetic storms."
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="inline-flex items-center rounded-full bg-white/5 border border-white/10 p-1">
          <button
            onClick={() => setActiveView('historic')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeView === 'historic' ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            Top Dst Storms
          </button>
          <button
            onClick={() => setActiveView('kyoto')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeView === 'kyoto' ? 'bg-fuchsia-600 text-white' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            Kyoto Dst
          </button>
        </div>
      </div>

      {activeView === 'historic' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-neutral-400 border-b border-neutral-700/70">
              <tr>
                <th className="text-left py-2 pr-2">#</th>
                <th className="text-left py-2 pr-2">Date</th>
                <th className="text-left py-2 pr-2">Dst</th>
                <th className="text-left py-2 pr-2">Ap</th>
                <th className="text-left py-2">Kp</th>
              </tr>
            </thead>
            <tbody>
              {HISTORIC_STORMS.map((storm, index) => (
                <tr key={`${storm.date}-${storm.dst}`} className="border-b border-neutral-800/70">
                  <td className="py-2 pr-2 text-neutral-500">{index + 1}</td>
                  <td className="py-2 pr-2 text-neutral-100">{storm.date}</td>
                  <td className="py-2 pr-2"><span className="bg-red-700 text-white rounded-md px-2 py-0.5 font-semibold">{storm.dst}nT</span></td>
                  <td className="py-2 pr-2 text-neutral-100 font-semibold">{storm.ap}</td>
                  <td className="py-2 text-red-400 font-semibold">{storm.kp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="text-xs text-neutral-400 mb-3">Latest from Kyoto Dst feed · Updated: {kyotoUpdatedLabel}</div>
          {isLoadingKyoto ? (
            <div className="text-sm text-neutral-300">Loading Kyoto Dst…</div>
          ) : kyotoError ? (
            <div className="text-sm text-amber-300">{kyotoError}</div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto styled-scrollbar">
              <table className="w-full text-sm">
                <thead className="text-neutral-400 border-b border-neutral-700/70 sticky top-0 bg-neutral-950/95">
                  <tr>
                    <th className="text-left py-2 pr-2">Time (NZT)</th>
                    <th className="text-left py-2">Dst</th>
                  </tr>
                </thead>
                <tbody>
                  {kyotoRows.map((row) => (
                    <tr key={row.timestamp} className="border-b border-neutral-800/70">
                      <td className="py-2 pr-2 text-neutral-100">{new Date(row.timestamp).toLocaleString('en-NZ')}</td>
                      <td className="py-2">
                        <span className={`rounded-md px-2 py-0.5 font-semibold ${row.dst <= -100 ? 'bg-red-700 text-white' : row.dst <= -50 ? 'bg-amber-700 text-white' : 'bg-neutral-700 text-neutral-100'}`}>
                          {row.dst}nT
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DisturbanceIndexPanel;
