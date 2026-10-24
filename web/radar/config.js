// O navegador acessa somente o backend do Sideral. Chaves de provedores
// meteorológicos devem existir apenas nas variáveis secretas do servidor.

export const CONFIG = Object.freeze({
  rainviewerApi: 'https://api.rainviewer.com/public/weather-maps.json',
  center: [-51.925, -14.235],
  ipmetBounds: [-55.876, -26.4, -44.516, -18.08],
  ipmetOfficial: 'https://www.ipmetradar.com.br/mobile2/openlayers/ipmet/radar.php',
  ipmetRadars: [
    { id:'ipmet-bauru', code:'ipmet-bauru', provider:'IPMet', name:'IPMet — Bauru/SP', latitude:-22.358252, longitude:-49.027213, rangeKm:240, surveillanceKm:450, projection:'EPSG:900913' },
    { id:'ipmet-prudente', code:'ipmet-prudente', provider:'IPMet', name:'IPMet — Presidente Prudente/SP', latitude:-22.175057, longitude:-51.3742, rangeKm:240, surveillanceKm:450, projection:'EPSG:900913' }
  ]
});

export const API_BASE = 'https://sideral-backend.onrender.com';

export function proxyBase() {
  const explicit = window.SIDERAL_RADAR_PROXY_BASE || window.SIDERAL_API_BASE || localStorage.getItem('sideralRadarProxyBase') || localStorage.getItem('sideralApiBase');
  if (explicit) return explicit.replace(/\/$/, '');
  if (location.port === '8766') return location.origin;
  if (['localhost','127.0.0.1'].includes(location.hostname)) return 'http://127.0.0.1:8766';
  return API_BASE;
}

export const MAP_THEMES = Object.freeze({
  light:{ tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution:'Tiles © Esri' },
  gray:{ tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution:'Tiles © Esri' },
  dark:{ tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution:'Tiles © Esri' },
  satellite:{ tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution:'Tiles © Esri' }
});

export async function fetchJson(url, options={}, timeout=16000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeout);
  try {
    const response = await fetch(url, {...options, signal:controller.signal, cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function parseDate(value) {
  if (typeof value === 'number') return new Date(value * 1000);
  if (!value) return null;
  const text=String(value).replace(' ','T');
  const result=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)?text:`${text}Z`);
  return Number.isNaN(result.getTime())?null:result;
}
export function formatDate(value) { const date=value instanceof Date?value:parseDate(value); return date?date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'; }
export function preference(key,fallback){try{return localStorage.getItem(key)??fallback}catch{return fallback}}
export function savePreference(key,value){try{localStorage.setItem(key,String(value))}catch{}}
