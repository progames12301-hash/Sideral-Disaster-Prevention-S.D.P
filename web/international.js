(() => {
  const root = document.documentElement;
  const country = String(root.dataset.country || document.body.dataset.country || '').toLowerCase();
  const profiles = {
    mexico: { label: 'México', center: [23.4, -102.2], zoom: 5, source: 'CIRES / SASMEX + S.D.P' },
    japan: { label: 'Japão', center: [36.2, 138.1], zoom: 5, source: 'JMA + S.D.P' }
  };
  const profile = profiles[country];
  if (!profile) return;

  const $ = id => document.getElementById(id);
  const els = {
    countryLabel: $('countryLabel'), sourceName: $('sourceName'), sourceMode: $('sourceMode'),
    sourceError: $('sourceError'), eventStatus: $('eventStatus'), eventPlace: $('eventPlace'),
    eventTime: $('eventTime'), magnitude: $('magnitude'), magnitudeMeta: $('magnitudeMeta'),
    depth: $('depth'), intensity: $('intensity'), stationCount: $('stationCount'),
    sourceUpdated: $('sourceUpdated'), stationNote: $('stationNote'), mapStatus: $('mapStatus')
  };

  els.countryLabel.textContent = profile.label;
  els.sourceName.textContent = profile.source;

  const map = L.map('intlMap', { zoomControl: true, minZoom: 3, maxZoom: 10 }).setView(profile.center, profile.zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const eventLayer = L.layerGroup().addTo(map);
  const stationLayer = L.layerGroup().addTo(map);
  let currentEvent = null;
  let currentStations = [];
  let pCircle = null;
  let sCircle = null;

  function fmtTime(epoch, fallback) {
    if (Number.isFinite(Number(epoch))) {
      return new Date(Number(epoch) * 1000).toLocaleString('pt-BR', { hour12: false });
    }
    if (fallback) {
      const d = new Date(fallback);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString('pt-BR', { hour12: false });
    }
    return '—';
  }

  function waveRadiusKm(elapsed, velocity, depth) {
    const travelled = Math.max(0, elapsed) * Math.max(0.1, velocity);
    const z = Math.max(0, depth || 0);
    if (travelled <= z) return 0;
    return Math.sqrt(Math.max(0, travelled * travelled - z * z));
  }

  function stationColor(level) {
    return ['#1565c0','#1e88e5','#00acc1','#43a047','#fdd835','#fb8c00','#e53935','#8e24aa'][Math.max(0, Math.min(7, level))];
  }

  function renderStations(stations) {
    currentStations = Array.isArray(stations) ? stations : [];
    stationLayer.clearLayers();
    for (const st of currentStations) {
      const lat = Number(st.lat), lon = Number(st.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const level = Math.max(0, Math.min(7, Math.round(Number(st.level ?? st.activityLevel ?? 0))));
      const live = st.live === true;
      const observed = st.observed === true;
      const icon = L.divIcon({
        className: '',
        html: `<div class="station-marker${live ? ' live' : observed ? ' observed' : ' metadata'}" style="background:${stationColor(level)}"><span>${level}</span></div>`,
        iconSize: [18,18], iconAnchor: [9,9]
      });
      const source = st.source ? ` · ${st.source}` : '';
      let mode = 'nível 0 · estação cadastrada';
      if (live) {
        const latency = Number.isFinite(Number(st.latencySeconds)) ? ` · ${Number(st.latencySeconds).toFixed(1)} s` : '';
        mode = `TEMPO REAL · nível ${level}${latency}`;
      } else if (observed) {
        mode = `JMA observado · Shindo ${st.observedShindo || level} · nível ${level}`;
      }
      L.marker([lat, lon], { icon })
        .bindTooltip(`${st.name || st.key || 'Estação'} · ${mode}${source}`)
        .addTo(stationLayer);
    }
  }

  function renderEvent(event) {
    currentEvent = event || null;
    eventLayer.clearLayers();
    pCircle = null;
    sCircle = null;

    if (!event) {
      els.eventStatus.textContent = 'Nenhum evento ativo';
      els.eventPlace.textContent = 'Monitoramento em tempo real';
      els.eventTime.textContent = '—';
      els.magnitude.textContent = '—';
      els.magnitudeMeta.textContent = '—';
      els.depth.textContent = '—';
      els.intensity.textContent = '—';
      els.stationCount.textContent = String(currentStations.length || '—');
      return;
    }

    els.eventStatus.textContent = event.statusLabel || event.status || 'Evento';
    els.eventPlace.textContent = event.area || (event.lat != null && event.lon != null ? `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°` : 'Localização em processamento');
    els.eventTime.textContent = fmtTime(event.originEpoch, event.originTime);
    els.magnitude.textContent = event.magnitude != null ? Number(event.magnitude).toFixed(1) : '—';
    els.magnitudeMeta.textContent = event.magnitudeType || (event.official ? 'fonte oficial' : 'detecção S.D.P');
    els.depth.textContent = event.depthKm != null ? `${Number(event.depthKm).toFixed(0)} km` : '—';
    els.intensity.textContent = event.maxIntensity || '—';
    els.stationCount.textContent = event.stationCount ?? currentStations.length ?? '—';

    const lat = Number(event.lat), lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const icon = L.divIcon({ className: '', html: '<div class="epicenter-cross"></div>', iconSize: [26,26], iconAnchor: [13,13] });
    L.marker([lat,lon], { icon, zIndexOffset: 1000 }).bindTooltip(event.statusLabel || 'Epicentro').addTo(eventLayer);

    const age = Date.now()/1000 - Number(event.originEpoch);
    if (event.waveEligible === true && Number.isFinite(age) && age >= -3 && age <= 420) {
      pCircle = L.circle([lat,lon], { radius: 0, color:'#38bdf8', fill:false, weight:2, opacity:.95, interactive:false }).addTo(eventLayer);
      sCircle = L.circle([lat,lon], { radius: 0, color:'#ff3b68', fill:false, weight:3, opacity:.95, interactive:false }).addTo(eventLayer);
    }
  }

  function animate() {
    const e = currentEvent;
    if (e && pCircle && sCircle && Number.isFinite(Number(e.originEpoch))) {
      const elapsed = Math.max(0, Date.now()/1000 - Number(e.originEpoch));
      const depth = Math.max(0, Number(e.depthKm || 0));
      const vp = Number(e.pVelocityKmS || 6.0);
      const vs = Number(e.sVelocityKmS || 3.5);
      pCircle.setRadius(Math.min(1200, waveRadiusKm(elapsed, vp, depth)) * 1000);
      sCircle.setRadius(Math.min(1200, waveRadiusKm(elapsed, vs, depth)) * 1000);
    }
    requestAnimationFrame(animate);
  }

  async function refresh() {
    try {
      const res = await fetch(`/api/international/${country}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const stations = Array.isArray(data.stations) ? data.stations : [];
      const liveCount = Number(data.liveStationCount || stations.filter(st => st.live === true).length || 0);
      const observedCount = Number(data.observedStationCount || stations.filter(st => st.observed === true).length || 0);
      const streamSources = Array.isArray(data.streamSources) ? data.streamSources : [];
      const streaming = streamSources.filter(src => src.state === 'streaming').length;

      if (country === 'japan') {
        els.sourceMode.textContent = `JMA oficial + waveform sísmico público em tempo real · ${streaming} stream ativo${streaming === 1 ? '' : 's'}`;
      } else {
        els.sourceMode.textContent = `CIRES/SASMEX oficial + waveform de redes sísmicas públicas · ${streaming} stream ativo${streaming === 1 ? '' : 's'}`;
      }

      els.sourceUpdated.textContent = data.lastUpdate ? `atualizado ${new Date(data.lastUpdate).toLocaleTimeString('pt-BR')}` : 'iniciando';
      const errors = [data.error, data.stationError].filter(Boolean);
      els.sourceError.textContent = errors.join(' · ');
      els.sourceError.classList.toggle('show', errors.length > 0);

      const parts = [`${stations.length} estações reais`, `${liveCount} recebendo movimento agora`];
      if (country === 'japan' && observedCount) parts.push(`${observedCount} com intensidade JMA observada`);
      els.stationNote.textContent = `${parts.join(' · ')}. 0 = repouso; 1–7 somente por sinal significativo e sustentado.`;

      const displayEvent = data.displayEvent || data.detectedEvent || data.event || null;
      if (data.event?.eewEligible) {
        els.mapStatus.textContent = country === 'japan' ? 'JMA EEW OFICIAL' : 'ALERTA SASMEX OFICIAL';
      } else if (data.detectedEvent && displayEvent?.id === data.detectedEvent?.id) {
        els.mapStatus.textContent = 'DETECÇÃO S.D.P · WAVEFORM MULTIESTAÇÃO';
      } else {
        els.mapStatus.textContent = 'MONITORAMENTO SÍSMICO EM TEMPO REAL';
      }
      renderStations(stations);
      renderEvent(displayEvent);
    } catch (err) {
      els.sourceError.textContent = `Backend/fonte indisponível: ${err.message}`;
      els.sourceError.classList.add('show');
    }
  }

  refresh();
  setInterval(refresh, country === 'japan' ? 3000 : 5000);
  animate();
})();
