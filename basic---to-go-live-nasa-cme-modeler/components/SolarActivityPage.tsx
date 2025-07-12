import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale, LogarithmicScale, ChartOptions, ChartData } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format } from 'date-fns'; // Import date-fns format utility

// Register Chart.js components globally once
ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale);

interface SolarActivityPageProps {
  onMediaSelect: (media: { url: string; type: 'image' | 'video' }) => void;
}

const SolarActivityPage: React.FC<SolarActivityPageProps> = ({ onMediaSelect }) => {
  // States for all the data and UI elements
  const [flares, setFlares] = useState<any[]>([]);
  const [sunspots, setSunspots] = useState<any[]>([]);
  const [xrayChartData, setXrayChartData] = useState<ChartData<'line'>>({ labels: [], datasets: [] });
  const xrayChartInstanceRef = useRef<any>(null); // Use ref for chart instance to destroy/recreate
  const allXrayRawDataRef = useRef<any[]>([]); // Store full raw data for filtering
  const [currentChartDuration, setCurrentChartDuration] = useState(2 * 60 * 60 * 1000); // Default to 2 hours
  
  // State for loading indicators
  const [suvi131Loading, setSuvi131Loading] = useState(true);
  const [suvi304Loading, setSuvi304Loading] = useState(true);
  const [xrayLoading, setXrayLoading] = useState(true);
  const [flaresLoading, setFlaresLoading] = useState(true);
  const [sunspotsLoading, setSunspotsLoading] = useState(true);

  // Constants (moved from old HTML script block)
  const NASA_API_KEY = 'DEMO_KEY'; // REMINDER: Replace with your actual key in production
  const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
  const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
  const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';
  const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';
  const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
  const NASA_DONKI_FLARES_URL = useCallback((startDate: string, endDate: string) => 
        `${NASA_DONKI_BASE_URL}FLR?startDate=${startDate}&endDate=${endDate}&api_key=${NASA_API_KEY}`, [NASA_API_KEY]);
  
  // Helper function to get computed style values from CSS :root
  const getCssVar = useCallback((name: string) => {
    // Fallback for cases where getComputedStyle might not be immediately available (e.g., SSR)
    return typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  }, []);

  // Helper function to get color based on flux value for chart segments
  const getColorForFlux = useCallback((value: number, opacity = 1) => {
    let rgb;
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb'); 
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb');    
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb');    
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb');    
    else if (value >= 1e-8) rgb = getCssVar('--solar-flare-ab-rgb');   
    else rgb = getCssVar('--solar-flare-ab-rgb'); 
    return `rgba(${rgb || '34, 197, 94'}, ${opacity})`; // Provide a default RGB if CSS var not found
  }, [getCssVar]);

  // Helper to get date strings for API calls
  const getApiDateRange = useCallback((daysAgo = 7) => {
    const today = new Date();
    const endDate = format(today, 'yyyy-MM-dd'); 
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - daysAgo);
    const startIsoDate = format(startDate, 'yyyy-MM-dd');
    return { startDate: startIsoDate, endDate: endDate };
  }, []);

  // --- Image Fetching Logic ---
  const fetchImage = useCallback(async (url: string, imgElementId: string, loadingSetter: React.Dispatch<React.SetStateAction<boolean>>) => {
    const imgElement = document.getElementById(imgElementId) as HTMLImageElement;
    if (!imgElement) {
        console.error(`[fetchImage] Image element not found for ID: ${imgElementId}`);
        return;
    }
    
    loadingSetter(true);
    imgElement.src = '/placeholder.png'; // Show placeholder while loading

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP status: ${response.status}`);
        }
        
        // Use a Promise to handle image loading events reliably
        await new Promise((resolve, reject) => {
            imgElement.onload = () => { resolve(true); };
            imgElement.onerror = (e) => { 
                console.error(`Image load error event:`, e); 
                reject(new Error('Image onerror event triggered.')); 
            };
            imgElement.src = url; // Set src to trigger load
        });
        
    } catch (error: any) {
        console.error(`[fetchImage] Error loading image from ${url}:`, error.message);
        imgElement.src = '/error.png'; 
    } finally {
        loadingSetter(false);
    }
  }, []);


  // --- X-Ray Flux Chart Logic ---
  const renderXrayFluxChart = useCallback((data: any[]) => {
    if (!document.getElementById('xrayFluxChart')) {
        // This can happen if component unmounts before chart is rendered
        return; 
    }
    const ctx = (document.getElementById('xrayFluxChart') as HTMLCanvasElement).getContext('2d');
    if (!ctx) {
        console.error("Failed to get 2D context for X-ray chart.");
        return;
    }

    const labels = data.map((d: any) => d.time);
    const shortFluxValues = data.map((d: any) => d.short);

    // Chart options are defined here, which are then passed to the Line component
    const chartOptions: ChartOptions<'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        stacked: false, 
        plugins: {
          legend: { labels: { color: '#a1a1aa' } },
          tooltip: {
            mode: 'index', intersect: false,
            callbacks: {
              title: (context: any) => new Date(context[0].parsed.x).toLocaleString(),
              label: (context: any) => {
                const value = context.parsed.y;
                let fluxClass = '';
                if (value >= 1e-4) fluxClass = 'X';
                else if (value >= 1e-5) fluxClass = 'M';
                else if (value >= 1e-6) fluxClass = 'C';
                else if (value >= 1e-7) fluxClass = 'B';
                else fluxClass = 'A';
                return `Short Flux: ${value.toExponential(2)} (${fluxClass}-class)`;
              }
            }
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'minute', tooltipFormat: 'MMM dd, HH:mm', displayFormats: { minute: 'HH:mm', hour: 'HH:mm' } },
            title: { display: true, text: 'Time (UTC)', color: '#fafafa' },
            ticks: { color: '#71717a' },
            grid: { color: '#3f3f46' }
          },
          y: {
            type: 'logarithmic',
            title: { display: true, text: 'X-ray Flux (W/m²)', color: '#fafafa' },
            ticks: {
              callback: (value: any) => {
                if (value === 1e-3) return 'X10.0'; 
                if (value === 1e-4) return 'X1.0';  
                if (value === 1e-5) return 'M1.0';  
                if (value === 1e-6) return 'C1.0';  
                if (value === 1e-7) return 'B1.0';  
                if (value === 1e-8) return 'A1.0';  
                return null; 
              },
              color: '#71717a', 
            },
            grid: {
              color: '#3f3f46', 
              lineWidth: (context: any) => {
                if (context.tick.value === 1e-4 || context.tick.value === 1e-5 || context.tick.value === 1e-6 || context.tick.value === 1e-7 || context.tick.value === 1e-8) {
                    return 1.5;
                }
                return 0.5;
              },
              drawOnChartArea: true,
              drawTicks: true,
            },
            min: 1e-9, max: 1e-3 
          }
        }
    };

    const chartData: ChartData<'line'> = {
        labels: labels,
        datasets: [
            {
                label: 'Short Flux (0.1-0.8 nm)',
                data: shortFluxValues,
                pointRadius: 0,
                tension: 0.1, 
                spanGaps: true, 
                fill: 'origin', 
                borderWidth: 2, 
                lineCap: 'round', 
                lineJoin: 'round', 
                segment: { 
                    borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1),
                    backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2),
                }
            }
        ]
    };
    
    // Update state to trigger Chart.js re-render in JSX
    setXrayChartData(chartData);
    setXrayChartOptions(chartOptions);

  }, [getColorForFlux]);


  const filterAndRenderChart = useCallback((durationMs: number, allData: any[]) => {
    const now = Date.now();
    const startTime = now - durationMs;
    const filteredData = allData.filter((d: any) => d.time.getTime() >= startTime);
    renderXrayFluxChart(filteredData);
  }, [renderXrayFluxChart]);

  const fetchXrayFlux = useCallback(async () => {
    setXrayLoading(true);
    try {
      const response = await fetch(NOAA_XRAY_FLUX_URL);
      if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
      const rawData = await response.json();

      const groupedData = new Map();
      rawData.forEach((d: any) => {
        const time = new Date(d.time_tag).getTime();
        if (!groupedData.has(time)) groupedData.set(time, { time: new Date(d.time_tag), short: null, long: null });
        const entry = groupedData.get(time);
        if (d.energy === "0.1-0.8nm") entry.short = parseFloat(d.flux);
        else if (d.energy === "0.05-0.4nm") entry.long = parseFloat(d.flux);
      });
      allXrayRawDataRef.current = Array.from(groupedData.values()).filter((d: any) => !isNaN(d.short) && d.short !== null).sort((a: any, b: any) => a.time - b.time);

      filterAndRenderChart(currentChartDuration, allXrayRawDataRef.current);
    } catch (error) {
      console.error("Error fetching X-ray flux:", error);
      setXrayChartData({ labels: [], datasets: [] }); // Clear chart on error
    } finally {
      setXrayLoading(false);
    }
  }, [filterAndRenderChart, currentChartDuration]);


  // --- Fetch Flares (NASA DONKI) ---
  const fetchFlares = useCallback(async () => {
    setFlaresLoading(true);
    try {
      const { startDate, endDate } = getApiDateRange(7);
      const response = await fetch(NASA_DONKI_FLARES_URL(startDate, endDate));
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setFlares(Array.isArray(data) ? data.sort((a: any, b: any) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime()) : []);
    } catch (error) {
      console.error("Error fetching solar flares:", error);
      setFlares([]);
    } finally {
      setFlaresLoading(false);
    }
  }, [getApiDateRange, NASA_DONKI_FLARES_URL]);

  // --- Fetch Sunspots (NOAA SWPC) ---
  const fetchSunspots = useCallback(async () => {
    setSunspotsLoading(true);
    try {
      const response = await fetch(NOAA_SOLAR_REGIONS_URL);
      if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
      const data = await response.json();

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const earthFacingRegions = data.filter((region: any) => {
        const observedDate = new Date(region.observed_date);
        const longitude = parseFloat(region.longitude);
        return !isNaN(observedDate.getTime()) && observedDate >= twoWeeksAgo && !isNaN(longitude) && Math.abs(longitude) <= 90;
      });
      setSunspots(earthFacingRegions.sort((a: any, b: any) => b.region - a.region));
    } catch (error) {
      console.error("Error fetching sunspots:", error);
      setSunspots([]);
    } finally {
      setSunspotsLoading(false);
    }
  }, []);

  // --- Initial Data Load and Interval ---
  useEffect(() => {
    const runInitialFetches = () => {
      // Images (SUVI) are fetched directly via fetchImage, not through state
      fetchImage(SUVI_131_URL, 'suvi-131-img', setSuvi131Loading);
      fetchImage(SUVI_304_URL, 'suvi-304-img', setSuvi304Loading);
      fetchXrayFlux();
      fetchFlares();
      fetchSunspots();
    };

    runInitialFetches();
    const intervalId = setInterval(runInitialFetches, 5 * 60 * 1000); // Update every 5 minutes

    return () => {
      clearInterval(intervalId);
      if (xrayChartInstanceRef.current) {
        xrayChartInstanceRef.current.destroy(); // Destroy chart on component unmount
      }
    };
  }, [fetchImage, fetchXrayFlux, fetchFlares, fetchSunspots, SUVI_131_URL, SUVI_304_URL]); // Dependencies for useEffect

  // --- Handle Chart Duration Change ---
  const handleDurationChange = useCallback((durationMs: number) => {
    setCurrentChartDuration(durationMs);
    filterAndRenderChart(durationMs, allXrayRawDataRef.current);

    document.querySelectorAll('.time-preset-button').forEach(button => {
        if (parseInt(button.dataset.duration || '0') === durationMs) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
  }, [filterAndRenderChart]);

  return (
    <div className="w-full h-full bg-black text-neutral-300 styled-scrollbar" style={{overflowY: 'auto'}}>
      <style>{`
        /* All CSS from solar-activity.html goes here. */
        :root {
            --bg-main: #0a0a0a;
            --bg-card: #171717;
            --border-color: #3f3f46;
            --text-primary: #fafafa;
            --text-secondary: #a1a1aa;
            --text-muted: #71717a;
            --link-color: #60a5fa;
            
            --solar-flare-ab-rgb: 34, 197, 94; 
            --solar-flare-c-rgb: 245, 158, 11; 
            --solar-flare-m-rgb: 255, 69, 0; 
            --solar-flare-x-rgb: 239, 68, 68; 
            --solar-flare-x5plus-rgb: 147, 112, 219; 
        }
        /* body styles should mostly be applied to parent div - these are for global context if this component were standalone */
        .solar-activity-background::before,
        .solar-activity-background::after {
            content: '';
            position: fixed;
            top: 0; 
            left: 0;
            width: 200%;
            height: 100%; 
            z-index: 0;
            opacity: 0.8;
            will-change: transform;
            mask-image: radial-gradient(circle at center, black 0%, transparent 70%);
            -webkit-mask-image: radial-gradient(circle at center, black 0%, transparent 70%);
        }
        .solar-activity-background::before {
            background: 
                radial-gradient(circle at 25% 50%, rgba(255, 229, 107, 0.2) 0%, transparent 40%),
                radial-gradient(circle at 75% 40%, rgba(255, 159, 67, 0.25) 0%, transparent 50%);
            animation: moveSolarGlow 35s linear infinite;
        }
        .solar-activity-background::after {
            background: 
                radial-gradient(circle at 20% 70%, rgba(255, 107, 107, 0.15) 0%, transparent 40%),
                radial-gradient(circle at 80% 60%, rgba(245, 158, 11, 0.2) 0%, transparent 50%);
            animation: moveSolarGlow 50s linear infinite reverse;
        }
        @keyframes moveSolarGlow {
            from { transform: translateX(-50%) rotate(0deg); }
            to { transform: translateX(0%) rotate(360deg); }
        }
        
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            position: relative;
            z-index: 1;
            padding: 20px; 
        }
        .header { /* This header is outside this component, so this rule is for general styling consistency */ }
        .header-logo { max-width: 250px; height: auto; margin-bottom: 15px; }
        .header .logo-link { display: inline-block; transition: transform 0.2s ease-in-out; }
        .header .logo-link:hover { transform: scale(1.03); }
        h1 { font-size: 2.25rem; color: var(--text-primary); margin: 0; }
        .dashboard-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; }
        .card { 
            background-color: rgba(23, 23, 23, 0.85); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
            border: 1px solid var(--border-color); border-radius: 16px; padding: 25px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2); 
            display: flex; flex-direction: column; height: 450px; 
        }
        .card-title { font-size: 1.1rem; text-align: center; font-weight: 600; color: var(--text-primary); margin: 0; }
        .card-title-container { position: relative; display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 20px; }
        
        .imagery-card { grid-column: span 12; height: 450px; } 
        .imagery-link { 
            display: flex; flex-direction: column; flex-grow: 1; justify-content: center; align-items: center;
            text-decoration: none; color: inherit; min-height: 0; 
        }
        .imagery-link img { 
            max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; margin-top: 15px; 
            transition: transform 0.2s ease-in-out; 
        }
        .imagery-link:hover img { transform: scale(1.02); }

        .chart-card { grid-column: span 12; height: 450px; }
        .chart-card .card-title-container { justify-content: flex-start; }
        .chart-wrapper { position: relative; flex-grow: 1; min-height: 0; }
        .chart-wrapper canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }

        .list-card { grid-column: 1 / -1; min-height: 300px; height: auto; } 
        .list-card ul { 
            list-style: none; padding: 0; margin: 0; max-height: 350px; overflow-y: auto;
            border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 15px; 
        }
        .list-card li { 
            background-color: rgba(63, 63, 70, 0.3); border: 1px solid var(--border-color); border-radius: 8px;
            padding: 10px 15px; margin-bottom: 10px; font-size: 0.9rem; color: var(--text-primary); 
        }
        .list-card li:last-child { margin-bottom: 0; }
        .list-card li span { display: block; color: var(--text-secondary); margin-top: 3px; }
        .list-card li strong { color: var(--text-primary); }
        .list-card .flare-class { font-weight: bold; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-left: 8px; }
        .class-A, .class-B { background-color: rgb(var(--solar-flare-ab-rgb)); color: white; }
        .class-C { background-color: rgb(var(--solar-flare-c-rgb)); color: black; }
        .class-M { background-color: rgb(var(--solar-flare-m-rgb)); color: white; }
        .class-X { background-color: rgb(var(--solar-flare-x-rgb)); color: white; }

        .loading-message { text-align: center; font-style: italic; color: var(--text-muted); margin-top: 20px; }
        .error-message { color: #ef4444; font-weight: bold; }

        .time-presets { display: flex; justify-content: center; gap: 10px; margin-top: 15px; margin-bottom: 20px; }
        .time-preset-button {
            background-color: #3f3f46; color: #fafafa; border: 1px solid #525252; padding: 8px 15px; border-radius: 8px;
            cursor: pointer; font-size: 0.9rem; transition: background-color 0.2s, border-color 0.2s;
        }
        .time-preset-button:hover { background-color: #525252; }
        .time-preset-button.active { background-color: #60a5fa; border-color: #60a5fa; color: white; font-weight: bold; }

        /* Media Queries for Desktop Layout */
        @media (min-width: 1200px) {
            .imagery-card { grid-column: span 6; }
            .list-card { grid-column: span 6; min-height: 450px; }
        }
        @media (max-width: 900px) { 
            h1 { font-size: 1.75rem; } 
            .time-presets { flex-wrap: wrap; }
            .card { padding: 20px; } 
        }
        @media (max-width: 600px) { 
            body { padding: 10px; } 
            .list-card ul { max-height: 200px; } 
        }
      `}</style>
      <div className="solar-activity-background fixed inset-0 z-0"></div> 
      <div className="container relative z-10"> 
        <header className="header">
          <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer" className="logo-link">
            <img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="header-logo" />
          </a>
          <h1>Spot The Aurora - Solar Activity Dashboard</h1>
        </header>

        <main className="dashboard-grid">
          <div className="card imagery-card">
            <div className="card-title-container">
              <h2 className="card-title">SUVI 131Å</h2>
            </div>
            <div className="imagery-link" onClick={() => onMediaSelect({ url: SUVI_131_URL, type: 'image' })}>
              <img id="suvi-131-img" src="/placeholder.png" alt="SUVI 131Å Image" />
              <p className="loading-message" id="loading-suvi-131">{suvi131Loading ? 'Loading image...' : ''}</p>
            </div>
          </div>
          <div className="card imagery-card">
            <div className="card-title-container">
              <h2 className="card-title">SUVI 304Å</h2>
            </div>
            <div className="imagery-link" onClick={() => onMediaSelect({ url: SUVI_304_URL, type: 'image' })}>
              <img id="suvi-304-img" src="/placeholder.png" alt="SUVI 304Å Image" />
              <p className="loading-message" id="loading-suvi-304">{suvi304Loading ? 'Loading image...' : ''}</p>
            </div>
          </div>

          <div className="card chart-card">
            <div className="card-title-container">
              <h2 className="card-title">GOES X-ray Flux (Short Wavelength)</h2>
            </div>
            <div className="time-presets">
              <button className="time-preset-button" data-duration="7200000" onClick={() => handleDurationChange(7200000)}>2 Hours</button>
              <button className="time-preset-button" data-duration="3600000" onClick={() => handleDurationChange(3600000)}>1 Hour</button>
              <button className="time-preset-button" data-duration="14400000" onClick={() => handleDurationChange(14400000)}>4 Hours</button>
              <button className="time-preset-button" data-duration="21600000" onClick={() => handleDurationChange(21600000)}>6 Hours</button>
            </div>
            <div className="chart-wrapper">
              {xrayLoading && <p className="loading-message absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">Loading X-ray flux data...</p>}
              {!xrayLoading && xrayChartData.datasets.length === 0 && <p className="error-message absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">No X-ray flux data available.</p>}
              {!xrayLoading && xrayChartData.datasets.length > 0 && <Line data={xrayChartData} options={xrayChartOptions} />}
            </div>
          </div>

          <div className="card list-card">
            <div className="card-title-container">
              <h2 className="card-title">Latest Solar Flares</h2>
            </div>
            <ul className="list-content">
              {flaresLoading && <p className="loading-message">Loading solar flares...</p>}
              {!flaresLoading && flares.length === 0 && <p className="loading-message">No solar flares reported recently.</p>}
              {!flaresLoading && flares.length > 0 && flares.map(flare => (
                <li key={flare.flareID || `${flare.peakTime}-${flare.classType}`}>
                  <strong>{flare.classType || 'Flare'}</strong> <span className={`flare-class class-${flare.classType ? flare.classType[0] : 'U'}`}>{flare.classType || 'N/A'}</span>
                  <span>Begin: {new Date(flare.beginTime).toLocaleString()}</span>
                  <span>Peak: {new Date(flare.peakTime).toLocaleString()}</span>
                  <span>End: {new Date(flare.endTime).toLocaleString()}</span>
                  <span>Region: {flare.activeRegionNum || 'N/A'}</span>
                  <span>Location: {flare.sourceLocation || 'N/A'}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card list-card">
            <div className="card-title-container">
              <h2 className="card-title">Latest Active Regions (Sunspots)</h2>
            </div>
            <ul className="list-content">
              {sunspotsLoading && <p className="loading-message">Loading active regions...</p>}
              {!sunspotsLoading && sunspots.length === 0 && <p className="loading-message">No Earth-facing active regions found in the last 2 weeks.</p>}
              {!sunspotsLoading && sunspots.length > 0 && sunspots.map(region => (
                <li key={region.region}>
                  <strong>Region {region.region}</strong> ({region.location || 'N/A'})
                  <span>Magnetic Class: {region.mag_class || 'N/A'}</span>
                  <span>Spot Class: {region.spot_class || 'N/A'}</span>
                  <span>Area: {region.area || 'N/A'} (approx)</span>
                  <span>Number of Spots: {region.number_spots || 'N/A'}</span>
                  <span>Observed: {new Date(region.observed_date).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  <span>C-Flare Prob: {region.c_flare_probability || 0}% | M-Flare Prob: {region.m_flare_probability || 0}% | X-Flare Prob: {region.x_flare_probability || 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </main>

        <footer className="page-footer">
          <p>Data courtesy of <a href="https://api.nasa.gov/DONKI/" target="_blank" rel="noopener noreferrer">NASA DONKI</a> and <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA SWPC</a></p>
          <p>Visualization by <a href="https://www.tnrprotography.co.nz/" target="_blank" rel="noopener noreferrer">TNR Protography</a></p>
        </footer>
      </div>
    </div>
  );
};

export default SolarActivityPage;