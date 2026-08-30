(() => {
  const root = document.documentElement;
  const country = String(root.dataset.country || document.body.dataset.country || '').toLowerCase();
  const profiles = {
    mexico: { label: 'México', center: [23.4, -102.2], zoom: 5, source: 'CIRES / SASMEX' },
    japan: { label: 'Japão', center: [36.2, 138.1], zoom: 5, source: 'JMA' }
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
      const icon = L.divIcon({
        className: '',
        html: `<div class="station-marker${live ? ' live' : ' metadata'}" style="background:${stationColor(level)}"><span>${level}</span></div>`,
        iconSize: [18,18], iconAnchor: [9,9]
      });
      const source = st.source ? ` · ${st.source}` : '';
      const mode = live ? `nível ${level}` : 'nível 0 · posição real, sem stream de movimento';
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
      els.eventStatus.textContent = 'Sem evento oficial ativo';
      els.eventPlace.textContent = 'Aguardando fonte';
      els.eventTime.textContent = '—';
      els.magnitude.textContent = '—';
      els.magnitudeMeta.textContent = '—';
      els.depth.textContent = '—';
      els.intensity.textContent = '—';
      els.stationCount.textContent = String(currentStations.length || '—');
      return;
    }

    els.eventStatus.textContent = event.statusLabel || event.status || 'Evento';
    els.eventPlace.textContent = event.area || (event.lat != null && event.lon != null ? `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°` : 'Localização não publicada');
    els.eventTime.textContent = fmtTime(event.originEpoch, event.originTime);
    els.magnitude.textContent = event.magnitude != null ? Number(event.magnitude).toFixed(1) : '—';
    els.magnitudeMeta.textContent = event.magnitudeType || '—';
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

      if (country === 'japan') {
        els.sourceMode.textContent = data.mode === 'official-eew'
          ? 'JMA EEW oficial + inventário de estações JMA'
          : 'JMA oficial · terremotos + inventário real de estações; EEW instantâneo aguarda feed autorizado';
      } else {
        els.sourceMode.textContent = 'CIRES/SASMEX oficial + inventário público de estações sísmicas no México';
      }

      els.sourceUpdated.textContent = data.lastUpdate ? `atualizado ${new Date(data.lastUpdate).toLocaleTimeString('pt-BR')}` : 'iniciando';
      const errors = [data.error, data.stationError].filter(Boolean);
      els.sourceError.textContent = errors.join(' · ');
      els.sourceError.classList.toggle('show', errors.length > 0);

      if (data.stationStreamAvailable) {
        els.stationNote.textContent = `${stations.length} estações com sinal em tempo real. 0 = repouso; 1–7 apenas quando o movimento cresce de forma significativa.`;
      } else if (data.stationMetadataAvailable || stations.length) {
        els.stationNote.textContent = `${stations.length} estações reais carregadas (${data.stationSource || 'inventário público'}). Por enquanto ficam em 0 porque ainda não existe stream de movimento compatível ligado ao S.D.P; nenhum nível é inventado.`;
      } else {
        els.stationNote.textContent = 'Carregando o inventário real de estações. Nenhuma estação artificial será criada.';
      }

      els.mapStatus.textContent = data.event?.eewEligible ? 'ALERTA/EEW OFICIAL RECEBIDO' : 'MONITOR OFICIAL · sem EEW ativo';
      renderStations(stations);
      renderEvent(data.event || null);
    } catch (err) {
      els.sourceError.textContent = `Backend/fonte indisponível: ${err.message}`;
      els.sourceError.classList.add('show');
    }
  }

  refresh();
  setInterval(refresh, country === 'japan' ? 4000 : 10000);
  animate();
})();
