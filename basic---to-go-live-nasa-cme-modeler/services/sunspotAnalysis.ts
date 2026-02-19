const NOAA_TXT = 'https://services.swpc.noaa.gov/text/solar-regions.txt';
const NOAA_SOLAR_REGIONS_JSON = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const NOAA_SUNSPOT_REPORT_JSON = 'https://services.swpc.noaa.gov/json/sunspot_report.json';
const SDO_LATEST_BASE = 'https://sdo.gsfc.nasa.gov/assets/img/latest/';

const RES = 1024;
const CACHE_TTL_MS = 180_000;
const LIMB_HIDE_CMD_DEG = 89;

const DETECT = {
  dogSigma1: 1.2,
  dogSigma2: 4.8,
  kSigma: 1.9,
  morphR: 1,
  minAreaFrac: 1.2e-6,
  maxRFrac: 0.985,
  clusterEpsFrac: 0.05,
};

type Region = {
  region_number: number;
  location: { lat_cmd: string | null; lat_deg: number | null; cmd_deg: number | null; heliographic_long_deg: number | null };
  area_msh: number | null;
  spot_count: number | null;
  mcintosh_extent: string | null;
  magnetic_class: string | null;
  flare_probability: { c_percent: number | null; m_percent: number | null; x_percent: number | null };
  events: Array<{ summary?: string; [key: string]: unknown }>;
};

export interface SunspotDashboardData {
  issued_utc: string | null;
  regions: Region[];
  imagery: {
    png_intensity_fast: string;
    png_magnetogram_fast: string;
  };
}

let lastCache: { at: number; data: SunspotDashboardData } | null = null;

export async function buildSunspotDashboardData(): Promise<SunspotDashboardData> {
  if (lastCache && (Date.now() - lastCache.at) < CACHE_TTL_MS) return lastCache.data;

  const payload = await buildPayload();
  const [intensityBytes, magnetogramBytes] = await Promise.all([
    fetchBinary(hmiUrl('intensity', RES)),
    fetchBinary(hmiUrl('magnetogram', RES)),
  ]);

  const intensityImage = await decodeToImageData(intensityBytes);
  const magnetogramImage = await decodeToImageData(magnetogramBytes);
  const disk = detectDiskFromRGBA(intensityImage.data, intensityImage.width, intensityImage.height);
  if (!disk) throw new Error('Disk detection failed');

  const det = detectSunspotsAndAssign({
    rgba: intensityImage.data,
    W: intensityImage.width,
    H: intensityImage.height,
    disk,
    regions: payload.regions,
    res: RES,
  });

  const intensityOverlay = drawOverlayPng({ imageData: intensityImage, disk, regions: payload.regions, assignment: det.assignment, clusters: det.clusters });
  const magnetogramOverlay = drawOverlayPng({ imageData: magnetogramImage, disk, regions: payload.regions, assignment: det.assignment, clusters: det.clusters });

  const data: SunspotDashboardData = {
    issued_utc: payload.issued_utc,
    regions: payload.regions,
    imagery: {
      png_intensity_fast: intensityOverlay,
      png_magnetogram_fast: magnetogramOverlay,
    },
  };

  lastCache = { at: Date.now(), data };
  return data;
}

function drawOverlayPng({ imageData, disk, regions, assignment, clusters }: { imageData: ImageData; disk: { cx: number; cy: number; R: number }; regions: Region[]; assignment: number[]; clusters: Array<{ cx: number; cy: number }> }) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.putImageData(imageData, 0, 0);

  ctx.textBaseline = 'top';
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const lat = r.location?.lat_deg;
    const cmd = r.location?.cmd_deg;
    if (typeof lat !== 'number' || typeof cmd !== 'number') continue;
    if (Math.abs(cmd) >= LIMB_HIDE_CMD_DEG) continue;

    const ci = assignment[i] ?? -1;
    const p = ci >= 0 && clusters[ci] ? clusters[ci] : noaaPoint(disk, lat, cmd);

    const vx = p.cx - disk.cx;
    const vy = p.cy - disk.cy;
    const len = Math.max(1, Math.hypot(vx, vy));
    const ux = vx / len;
    const uy = vy / len;
    const pad = 28;
    const lx = clamp(p.cx + ux * pad, 10, canvas.width - 10);
    const ly = clamp(p.cy + uy * pad, 10, canvas.height - 10);

    ctx.strokeStyle = 'rgba(255,255,255,0.70)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.cx, p.cy);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const anchorLeft = ux >= 0;
    const tx = anchorLeft ? lx + 8 : lx - 8;
    ctx.textAlign = anchorLeft ? 'left' : 'right';
    ctx.font = '700 18px system-ui';
    strokeFillText(ctx, `AR ${r.region_number}`, tx, ly - 8);
    ctx.font = '600 15px system-ui';
    const sub = `${(r.magnetic_class || '').trim()} ${(r.mcintosh_extent || '').trim()}`.trim();
    strokeFillText(ctx, sub, tx, ly + 14);
  }

  return canvas.toDataURL('image/png');
}

function strokeFillText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

async function decodeToImageData(bytes: Uint8Array): Promise<ImageData> {
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function buildPayload() {
  const txt = await fetchText(NOAA_TXT);
  const { issued_utc, regions_txt } = parseSolarRegionsTxt(txt);

  const [j1, j2] = await Promise.all([fetchJsonSafe(NOAA_SOLAR_REGIONS_JSON), fetchJsonSafe(NOAA_SUNSPOT_REPORT_JSON)]);
  const latest1 = latestByRegionNumber(j1);
  const latest2 = latestByRegionNumber(j2);

  const regions: Region[] = regions_txt.map((r: any) => {
    const s1 = latest1.get(r.region_number) || null;
    const s2 = latest2.get(r.region_number) || null;
    return {
      region_number: r.region_number,
      location: { lat_cmd: r.lat_cmd, lat_deg: r.lat_deg, cmd_deg: r.cmd_deg, heliographic_long_deg: r.heliographic_long },
      area_msh: r.area_msh,
      spot_count: r.spot_count,
      mcintosh_extent: r.mcintosh_extent,
      magnetic_class: r.magnetic_class,
      flare_probability: pickFlareProbabilities(s1, s2),
      events: pickEvents(s1, s2),
    };
  });

  return { issued_utc, regions };
}

async function fetchBinary(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function fetchText(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`); return r.text(); }
async function fetchJsonSafe(url: string) { try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; } }

function hmiUrl(which: 'intensity' | 'magnetogram', res: number) {
  const file = which === 'magnetogram' ? `latest_${res}_HMIB.jpg` : `latest_${res}_HMIIF.jpg`;
  return SDO_LATEST_BASE + file;
}

function parseSolarRegionsTxt(txt: string) {
  const issuedMatch = txt.match(/:Issued:\s*([0-9]{4}\s+\w+\s+[0-9]{1,2}\s+[0-9]{4}\s+UTC)/i);
  const issued_utc = issuedMatch ? issuedMatch[1] : null;
  const rowRe = /(\d{3,5})\s+([NS]\d{2}[EW]\d{2})\s+(\d{1,3})\s+(\d{1,4})\s+(\d{1,3})\s+([A-Z0-9]{3})\s+(\d{1,3})\s+([A-Z]{1,3})/g;
  const regions = [] as any[];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(txt)) !== null) {
    const { lat_deg, cmd_deg } = parseLatCmd(m[2]);
    regions.push({
      region_number: Number(m[1]), lat_cmd: m[2], heliographic_long: Number(m[3]), area_msh: Number(m[4]),
      mcintosh_extent: m[6], spot_count: Number(m[7]), magnetic_class: m[8], lat_deg, cmd_deg,
    });
  }
  return { issued_utc, regions_txt: regions };
}
function parseLatCmd(latCmd: string) {
  const m = latCmd.match(/^([NS])(\d{2})([EW])(\d{2})$/);
  if (!m) return { lat_deg: null, cmd_deg: null };
  const lat = (m[1] === 'N' ? 1 : -1) * Number(m[2]);
  const cmd = (m[3] === 'W' ? 1 : -1) * Number(m[4]);
  return { lat_deg: lat, cmd_deg: cmd };
}

function detectSunspotsAndAssign({ rgba, W, H, disk, regions, res }: any) {
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3;
  const flat = limbDarkeningCorrect(gray, W, H, disk);
  const scale = res / 1024;
  const g1 = gaussianBlur(flat, W, H, DETECT.dogSigma1 * scale);
  const g2 = gaussianBlur(flat, W, H, DETECT.dogSigma2 * scale);
  const dog = new Float32Array(W * H);
  for (let i = 0; i < dog.length; i++) dog[i] = g1[i] - g2[i];

  const stats = diskStats(dog, W, H, disk);
  const thr = stats.mu - DETECT.kSigma * stats.sigma;
  const mask = new Uint8Array(W * H);
  const R2 = disk.R * disk.R;
  for (let y = 0; y < H; y++) {
    const dy = y - disk.cy;
    for (let x = 0; x < W; x++) {
      const dx = x - disk.cx;
      const i = y * W + x;
      if (dx * dx + dy * dy > R2) continue;
      if (dog[i] < thr) mask[i] = 1;
    }
  }

  const cleaned = morphClose(morphOpen(mask, W, H, DETECT.morphR), W, H, DETECT.morphR);
  const comps = connectedComponents(cleaned, W, H);
  const minArea = Math.max(8, Math.floor(Math.PI * disk.R * disk.R * DETECT.minAreaFrac));
  const spots = comps.filter((c: any) => {
    if (c.area < minArea) return false;
    const rr = Math.hypot(c.cx - disk.cx, c.cy - disk.cy);
    if (rr > DETECT.maxRFrac * disk.R) return false;
    return localContrast(flat, cleaned, W, H, c, disk) >= 0.035;
  });

  const clusters = clusterSpots(spots, disk, DETECT.clusterEpsFrac);
  const assignment = assignNoaaToClusters(regions, clusters, disk);
  return { clusters, assignment };
}

function detectDiskFromRGBA(rgba: Uint8ClampedArray, W: number, H: number) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const p = (y * W + x) * 4; const v = (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3;
    if (v > 22) { sx += x; sy += y; n++; }
  }
  if (!n) return null;
  const cx = sx / n, cy = sy / n;
  const pts: Array<{ x: number; y: number }> = [];
  const maxR = Math.min(W, H) / 2 - 2;
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2;
    let last: { x: number; y: number } | null = null;
    for (let r = 0; r <= maxR; r++) {
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const p = (y * W + x) * 4;
      const v = (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3;
      if (v > 18) last = { x, y }; else if (last) break;
    }
    if (last) pts.push(last);
  }
  if (pts.length < 30) return null;
  let rsum = 0;
  for (const p of pts) rsum += Math.hypot(p.x - cx, p.y - cy);
  return { cx, cy, R: rsum / pts.length };
}

function limbDarkeningCorrect(gray: Float32Array, W: number, H: number, disk: any) {
  const bins = 240, sum = new Float64Array(bins), cnt = new Uint32Array(bins);
  const R2 = disk.R * disk.R;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - disk.cx, dy = y - disk.cy, rr2 = dx * dx + dy * dy;
    if (rr2 > R2) continue;
    const b = Math.min(bins - 1, Math.floor((Math.sqrt(rr2) / disk.R) * (bins - 1)));
    const i = y * W + x; sum[b] += gray[i]; cnt[b] += 1;
  }
  const prof = new Float32Array(bins);
  for (let i = 0; i < bins; i++) prof[i] = cnt[i] ? sum[i] / cnt[i] : (i ? prof[i - 1] : 1);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - disk.cx, dy = y - disk.cy, rr2 = dx * dx + dy * dy, i = y * W + x;
    if (rr2 > R2) { out[i] = gray[i]; continue; }
    const b = Math.min(bins - 1, Math.floor((Math.sqrt(rr2) / disk.R) * (bins - 1)));
    out[i] = gray[i] / (prof[b] + 1e-3);
  }
  return out;
}

function gaussianBlur(src: Float32Array, W: number, H: number, sigma: number) {
  sigma = Math.max(0.6, sigma);
  const r = Math.max(1, Math.floor(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0; for (let j = -r; j <= r; j++) s += src[y * W + clamp(x + j, 0, W - 1)] * k[j + r]; tmp[y * W + x] = s;
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    let s = 0; for (let j = -r; j <= r; j++) s += tmp[clamp(y + j, 0, H - 1) * W + x] * k[j + r]; out[y * W + x] = s;
  }
  return out;
}

const diskStats = (arr: Float32Array, W: number, H: number, disk: any) => {
  const R2 = disk.R * disk.R; let n = 0, s = 0, s2 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - disk.cx, dy = y - disk.cy; if (dx * dx + dy * dy > R2) continue;
    const v = arr[y * W + x]; n++; s += v; s2 += v * v;
  }
  const mu = s / Math.max(1, n); return { mu, sigma: Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mu * mu)) };
};

function erode(bin: Uint8Array, W: number, H: number, r: number) { if (r <= 0) return bin; const out = new Uint8Array(W * H); for (let y=0;y<H;y++) for (let x=0;x<W;x++) { let ok=1; for (let dy=-r;dy<=r&&ok;dy++) for (let dx=-r;dx<=r;dx++){const yy=y+dy,xx=x+dx;if(yy<0||yy>=H||xx<0||xx>=W||!bin[yy*W+xx]){ok=0;break;}} out[y*W+x]=ok;} return out; }
function dilate(bin: Uint8Array, W: number, H: number, r: number) { if (r <= 0) return bin; const out = new Uint8Array(W * H); for (let y=0;y<H;y++) for (let x=0;x<W;x++) { let ok=0; for (let dy=-r;dy<=r&&!ok;dy++) for (let dx=-r;dx<=r;dx++){const yy=y+dy,xx=x+dx;if(yy<0||yy>=H||xx<0||xx>=W) continue; if(bin[yy*W+xx]){ok=1;break;}} out[y*W+x]=ok;} return out; }
const morphOpen = (bin: Uint8Array, W: number, H: number, r: number) => dilate(erode(bin, W, H, r), W, H, r);
const morphClose = (bin: Uint8Array, W: number, H: number, r: number) => erode(dilate(bin, W, H, r), W, H, r);

function connectedComponents(bin: Uint8Array, W: number, H: number) {
  const vis = new Uint8Array(W * H), out: any[] = [], q = new Int32Array(W * H);
  for (let i = 0; i < bin.length; i++) if (bin[i] && !vis[i]) {
    let head=0, tail=0, area=0, sx=0, sy=0, x0=1e9, y0=1e9, x1=-1, y1=-1; q[tail++]=i; vis[i]=1;
    while (head < tail) {
      const idx=q[head++], y=(idx/W)|0, x=idx-y*W; area++; sx+=x; sy+=y; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
      const nbs = [x>0?idx-1:-1,x<W-1?idx+1:-1,y>0?idx-W:-1,y<H-1?idx+W:-1];
      for (const j of nbs) if (j>=0 && bin[j] && !vis[j]) { vis[j]=1; q[tail++]=j; }
    }
    out.push({ area, cx: sx/area, cy: sy/area, x0, y0, x1, y1 });
  }
  return out;
}

function localContrast(flat: Float32Array, mask: Uint8Array, W: number, H: number, comp: any, disk: any) {
  const cx = comp.cx, cy = comp.cy, R = disk.R, rIn = Math.max(3, Math.min(0.012 * R, 18)), rOut = rIn + Math.max(4, Math.min(0.02 * R, 26));
  let sIn=0,nIn=0,sOut=0,nOut=0; const R2 = R * R;
  for (let y=Math.max(0,Math.floor(cy-rOut-2)); y<=Math.min(H-1,Math.ceil(cy+rOut+2)); y++) for (let x=Math.max(0,Math.floor(cx-rOut-2)); x<=Math.min(W-1,Math.ceil(cx+rOut+2)); x++) {
    const dx=x-cx,dy=y-cy,rr=Math.hypot(dx,dy),dxD=x-disk.cx,dyD=y-disk.cy; if(dxD*dxD+dyD*dyD>R2) continue; const v=flat[y*W+x];
    if (rr<=rIn) { if(mask[y*W+x]){sIn+=v;nIn++;} } else if (rr<=rOut) { if(!mask[y*W+x]){sOut+=v;nOut++;} }
  }
  if(!nIn||!nOut) return 0; const meanIn=sIn/nIn, meanOut=sOut/nOut; return Math.max(0,(meanOut-meanIn)/Math.max(1e-6,meanOut));
}

function clusterSpots(spots: any[], disk: any, epsFrac: number) {
  if (!spots.length) return [];
  const eps = Math.max(10, epsFrac * disk.R), unvisited = new Array(spots.length).fill(true), clusters: any[] = [];
  for (let i=0;i<spots.length;i++) if (unvisited[i]) {
    unvisited[i]=false; const queue=[i], members:number[]=[];
    while(queue.length){ const a=queue.pop() as number; members.push(a); const ax=spots[a].cx, ay=spots[a].cy;
      for(let j=0;j<spots.length;j++) if(unvisited[j]) { const dx=spots[j].cx-ax, dy=spots[j].cy-ay; if(dx*dx+dy*dy<=eps*eps){unvisited[j]=false; queue.push(j);} }
    }
    let sA=0,sx=0,sy=0,totalArea=0,x0=1e9,y0=1e9,x1=-1,y1=-1;
    for (const idx of members){ const sp=spots[idx], w=Math.max(1,sp.area); sA+=w; sx+=sp.cx*w; sy+=sp.cy*w; totalArea+=sp.area; x0=Math.min(x0,sp.x0); y0=Math.min(y0,sp.y0); x1=Math.max(x1,sp.x1); y1=Math.max(y1,sp.y1); }
    clusters.push({cx:sx/sA, cy:sy/sA, spot_count:members.length, pixel_area:totalArea, x0,y0,x1,y1});
  }
  clusters.sort((a,b)=>a.cx-b.cx);
  return clusters;
}

function assignNoaaToClusters(regions: Region[], clusters: any[], disk: any) {
  const active: Array<{ idx: number; lat: number; cmd: number }> = [];
  for (let i=0;i<regions.length;i++) {
    const lat = regions[i].location?.lat_deg; const cmd = regions[i].location?.cmd_deg;
    if (typeof lat !== 'number' || typeof cmd !== 'number') continue;
    if (Math.abs(cmd) >= LIMB_HIDE_CMD_DEG) continue;
    active.push({ idx: i, lat, cmd });
  }
  const assignment = new Array(regions.length).fill(-1);
  if (!active.length || !clusters.length) return assignment;
  for (const a of active) {
    const p = noaaPoint(disk, a.lat, a.cmd);
    let best = -1, bestD = Infinity;
    for (let j=0;j<clusters.length;j++) {
      const d = Math.hypot(clusters[j].cx - p.cx, clusters[j].cy - p.cy);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best >= 0 && bestD <= 0.28 * disk.R) assignment[a.idx] = best;
  }
  return assignment;
}

function noaaPoint(disk: any, latDeg: number, cmdDeg: number) {
  const latR = (latDeg * Math.PI) / 180, cmdR = (cmdDeg * Math.PI) / 180;
  return { cx: disk.cx + Math.cos(latR) * Math.sin(cmdR) * disk.R, cy: disk.cy - Math.sin(latR) * disk.R };
}

function latestByRegionNumber(data: any) {
  const map = new Map<number, any>();
  const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
  for (const row of arr) {
    const n = extractRegionNumber(row); if (!Number.isFinite(n)) continue;
    const t = extractTime(row); const prev = map.get(n); if (!prev || (t ?? -Infinity) > (extractTime(prev) ?? -Infinity)) map.set(n, row);
  }
  return map;
}
function extractRegionNumber(row: any) { const v = firstDefined(row, ['region_number','region_num','noaa_region','noaa_region_number','region','ar','active_region','number','num']); return Number(String(v ?? '').replace(/[^\d]/g, '')); }
function extractTime(row: any) { const v = firstDefined(row, ['time_tag','time','timestamp','datetime','date_time','issued','observed','observation_time','start_time']); const ms = v ? new Date(v).getTime() : NaN; return Number.isFinite(ms) ? ms : null; }

function pickFlareProbabilities(a: any, b: any) {
  const obj = pickObject(a, b, ['flare_probability','flare_prob','probs','probabilities']);
  return {
    c_percent: normalizePercent(pickNumber(a, b, ['c_flare_prob','c_prob','prob_c','cflare_prob','c_flare_probability']) ?? obj?.c ?? obj?.C),
    m_percent: normalizePercent(pickNumber(a, b, ['m_flare_prob','m_prob','prob_m','mflare_prob','m_flare_probability']) ?? obj?.m ?? obj?.M),
    x_percent: normalizePercent(pickNumber(a, b, ['x_flare_prob','x_prob','prob_x','xflare_prob','x_flare_probability']) ?? obj?.x ?? obj?.X),
  };
}
function pickEvents(a: any, b: any) {
  const ev = pickArray(a, ['events','event_list','region_events','flares']) || pickArray(b, ['events','event_list','region_events','flares']) || [];
  return ev.map((e: any) => typeof e === 'string' ? { summary: e } : e).slice(0, 50);
}

function firstDefined(obj: any, keys: string[]) { for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k]; }
function pickValue(a: any, b: any, keys: string[]) { return firstDefined(a, keys) ?? firstDefined(b, keys) ?? null; }
function pickNumber(a: any, b: any, keys: string[]) { const n = Number(pickValue(a,b,keys)); return Number.isFinite(n) ? n : null; }
function pickObject(a: any, b: any, keys: string[]) { const v = pickValue(a,b,keys); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function pickArray(obj: any, keys: string[]) { for (const k of keys) if (Array.isArray(obj?.[k])) return obj[k]; return null; }
function normalizePercent(v: any) { const n = Number(v); if (!Number.isFinite(n)) return null; if (n>=0 && n<=1) return Math.round(n*100); if (n>=0 && n<=100) return Math.round(n); return null; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
