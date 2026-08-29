(() => {
  const BRAZIL_CENTER = [-14.2, -51.9];
  const BRAZIL_BOUNDS = [[-34.5, -74.5], [5.5, -34.0]];
  const map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 11, preferCanvas: true });
  map.fitBounds(BRAZIL_BOUNDS, { padding: [20, 20] });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const els = Object.fromEntries([
    'linkStatus','alertStrip','alertHeadline','eventTime','eventLocation','eventCoordinates','magnitudeType','magnitudeValue',
    'eventStatus','depthValue','stationCount','confidence','rmsValue','uncertainty','phaseCount','pickLatency','azimuthalGap','revision','eewMode','onlineCount','medianLatency','sources','targetText','pEta','sEta',
    'historyCount','historyList','utcClock','lastUpdate','mapNotice','locateMe','clearTarget','fitBrazil','toggleStations',
    'shindoValue','shindoMeta','shindoScale','targetShindo'
  ].map(id => [id, document.getElementById(id)]));

  const stationLayer = L.layerGroup().addTo(map);
  const eventLayer = L.layerGroup().addTo(map);
  const targetLayer = L.layerGroup().addTo(map);
  const stationMarkers = new Map();
  let stationVisible = true;
  let currentEvent = null;
  let history = [];
  let target = null;
  let pCircle = null;
  let sCircle = null;
  let uncertaintyCircle = null;
  let epicenterMarker = null;
  let ws = null;
  let retryTimer = null;

  const stationIcon = (online, triggered, latencyClass='unknown') => L.divIcon({
    className: '',
    html: `<div class="station-marker ${online ? 'online' : ''} ${triggered ? 'triggered' : ''} latency-${latencyClass || 'unknown'}"></div>`,
    iconSize: [10,10], iconAnchor: [5,5]
  });

  const epicenterIcon = L.divIcon({ className: '', html: '<div class="epicenter-marker"></div>', iconSize: [36,36], iconAnchor: [18,18] });
  const targetIcon = L.divIcon({ className: '', html: '<div class="target-marker"></div>', iconSize: [16,16], iconAnchor: [8,8] });

  function safe(v, fallback='—') { return v === null || v === undefined || Number.isNaN(v) ? fallback : v; }

  function formatUtc(epochOrIso) {
    const d = typeof epochOrIso === 'number' ? new Date(epochOrIso * 1000) : new Date(epochOrIso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'UTC', hour12: false, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) + ' UTC';
  }

  function relativeTime(epoch) {
    if (!epoch) return '—';
    const sec = Math.round(Date.now()/1000 - epoch);
    if (sec < 0) return `em ${Math.abs(sec)} s`;
    if (sec < 60) return `${sec} s atrás`;
    if (sec < 3600) return `${Math.floor(sec/60)} min atrás`;
    return `${Math.floor(sec/3600)} h atrás`;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371.0088;
    const toRad = d => d * Math.PI / 180;
    const p1 = toRad(lat1), p2 = toRad(lat2);
    const dlat = p2 - p1, dlon = toRad(lon2-lon1);
    const a = Math.sin(dlat/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dlon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Experimental Shindo proxy. A real JMA instrumental intensity requires calibrated strong-motion
  // acceleration and the official frequency/duration processing. Until those channels are available,
  // we estimate PGA from magnitude + hypocentral distance and convert it to a 1–7 display class.
  function shindoProxy(event, lat, lon) {
    if (!event || event.magnitude === null || event.magnitude === undefined) return null;
    const magnitude = Number(event.magnitude);
    if (!Number.isFinite(magnitude)) return null;
    const eventLat = Number(event.lat);
    const eventLon = Number(event.lon);
    if (!Number.isFinite(eventLat) || !Number.isFinite(eventLon)) return null;

    const surfaceKm = haversine(eventLat, eventLon, Number(lat), Number(lon));
    const depthKm = Math.max(0, Number(event.depthKm ?? 10));
    const rKm = Math.max(1, Math.sqrt(surfaceKm * surfaceKm + depthKm * depthKm));

    // Compact regional attenuation proxy (PGA in gal). It is intentionally labeled as estimated,
    // never as an official JMA observation.
    const saturation = 0.0055 * Math.pow(10, 0.5 * magnitude);
    const logPga = 0.5 * magnitude + 0.61 - Math.log10(rKm + saturation) - 0.003 * rKm;
    const pgaGal = Math.max(0.01, Math.pow(10, logPga));
    const instrumental = 2 * Math.log10(pgaGal) + 0.94;

    let level = 0;
    if (instrumental >= 6.5) level = 7;
    else if (instrumental >= 5.5) level = 6;
    else if (instrumental >= 4.5) level = 5;
    else if (instrumental >= 3.5) level = 4;
    else if (instrumental >= 2.5) level = 3;
    else if (instrumental >= 1.5) level = 2;
    else if (instrumental >= 0.5) level = 1;

    return { level, pgaGal, instrumental, distanceKm: rKm };
  }

  function renderShindo(event) {
    const steps = els.shindoScale ? [...els.shindoScale.querySelectorAll('.shindo-step')] : [];
    steps.forEach(step => step.classList.remove('active', 'passed'));

    if (!event || event.magnitude === null || event.magnitude === undefined) {
      if (els.shindoValue) els.shindoValue.textContent = '—';
      if (els.shindoMeta) els.shindoMeta.textContent = 'Aguardando magnitude confirmada';
      return;
    }

    const proxy = shindoProxy(event, event.lat, event.lon);
    if (!proxy) {
      if (els.shindoValue) els.shindoValue.textContent = '—';
      if (els.shindoMeta) els.shindoMeta.textContent = 'Estimativa indisponível';
      return;
    }

    if (els.shindoValue) els.shindoValue.textContent = proxy.level > 0 ? String(proxy.level) : '<1';
    if (els.shindoMeta) {
      els.shindoMeta.textContent = `proxy no hipocentro · PGA ≈ ${proxy.pgaGal.toFixed(proxy.pgaGal < 10 ? 1 : 0)} gal`;
    }
    steps.forEach(step => {
      const value = Number(step.dataset.shindo);
      if (proxy.level > 0 && value < proxy.level) step.classList.add('passed');
      if (value === proxy.level) step.classList.add('active');
    });
  }

  function isWaveEventActive(event) {
    if (!event) return false;
    const allowed = event.waveEligible === true || (event.waveEligible == null && event.eewEligible === true);
    if (!allowed) return false;
    const origin = Number(event.originEpoch || new Date(event.originTime).getTime()/1000);
    if (!Number.isFinite(origin)) return false;
    const age = Date.now()/1000 - origin;
    return age >= -5 && age <= 600;
  }

  function eventName(event) {
    if (!event) return 'Sem evento ativo';
    return event.status === 'catalog_confirmed' ? 'Evento confirmado no catálogo' : 'Epicentro estimado';
  }

  function renderEvent(event, pan=false) {
    currentEvent = event;
    if (!event) {
      els.alertStrip.classList.remove('active');
      els.alertHeadline.textContent = 'Rede sísmica em observação';
      els.eventTime.textContent = 'Aguardando detecção multiestação';
      els.eventLocation.textContent = 'Sem evento ativo';
      els.eventCoordinates.textContent = '—';
      els.magnitudeValue.textContent = '—';
      els.magnitudeType.textContent = 'quando confirmada';
      els.depthValue.textContent = '—';
      els.eventStatus.textContent = 'detecção automática';
      els.stationCount.textContent = '0';
      els.confidence.textContent = '—';
      els.rmsValue.textContent = '—';
      els.uncertainty.textContent = '—';
      els.phaseCount.textContent = '—';
      els.pickLatency.textContent = '—';
      els.azimuthalGap.textContent = '—';
      els.revision.textContent = '—';
      els.eewMode.textContent = 'EEW em espera';
      els.eewMode.className = 'eew-mode';
      if (els.targetShindo) els.targetShindo.textContent = '—';
      renderShindo(null);
      eventLayer.clearLayers();
      pCircle = null;
      sCircle = null;
      uncertaintyCircle = null;
      epicenterMarker = null;
      return;
    }

    els.alertStrip.classList.add('active');
    els.alertHeadline.textContent = event.status === 'catalog_confirmed' ? 'Evento associado ao catálogo' : (event.eewEligible ? 'Possível evento sísmico detectado' : 'Evento detectado com atraso de dados');
    els.eventTime.textContent = formatUtc(event.originEpoch || event.originTime);
    els.eventLocation.textContent = eventName(event);
    els.eventCoordinates.textContent = `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°`;
    els.magnitudeValue.textContent = event.magnitude != null ? Number(event.magnitude).toFixed(1) : '—';
    els.magnitudeType.textContent = event.magnitudeType || 'aguardando catálogo';
    els.depthValue.textContent = event.depthKm != null ? `${event.depthResolved === false ? '≈' : ''}${Number(event.depthKm).toFixed(0)}` : '—';
    els.eventStatus.textContent = event.statusLabel || event.status || 'preliminar';
    els.stationCount.textContent = safe(event.stationCount, '—');
    els.confidence.textContent = event.confidence != null ? `${event.confidence}%` : '—';
    els.rmsValue.textContent = event.rmsSeconds != null ? `${event.rmsSeconds}s` : '—';
    els.uncertainty.textContent = event.uncertaintyKm != null ? `±${event.uncertaintyKm} km` : '—';
    const phases = event.phaseCounts || {};
    els.phaseCount.textContent = `${safe(phases.P, 0)} / ${safe(phases.S, 0)}`;
    els.pickLatency.textContent = event.medianPickLatencySeconds != null ? `${Number(event.medianPickLatencySeconds).toFixed(1)}s` : '—';
    els.azimuthalGap.textContent = event.azimuthalGap != null ? `${Number(event.azimuthalGap).toFixed(0)}°` : '—';
    els.revision.textContent = event.revision != null ? `#${event.revision}` : '—';
    if (event.status === 'catalog_confirmed') {
      els.eewMode.textContent = 'CATÁLOGO CONFIRMADO';
      els.eewMode.className = 'eew-mode confirmed';
    } else if (event.eewEligible) {
      els.eewMode.textContent = 'BAIXA LATÊNCIA · EEW CANDIDATO';
      els.eewMode.className = 'eew-mode eligible';
    } else {
      els.eewMode.textContent = 'DETECÇÃO VALIDADA · SEM ONDAS EEW';
      els.eewMode.className = 'eew-mode late';
    }

    renderShindo(event);
    eventLayer.clearLayers();
    pCircle = null;
    sCircle = null;
    uncertaintyCircle = null;
    epicenterMarker = L.marker([event.lat, event.lon], { icon: epicenterIcon, zIndexOffset: 1200 }).addTo(eventLayer);
    epicenterMarker.bindTooltip(event.status === 'catalog_confirmed' ? 'Epicentro confirmado no catálogo' : 'Epicentro preliminar validado', { className: 'station-tooltip' });

    if (isWaveEventActive(event)) {
      pCircle = L.circle([event.lat, event.lon], { radius: 0, color: '#72d6ee', weight: 2, fillColor: '#72d6ee', fillOpacity: .015, interactive: false }).addTo(eventLayer);
      sCircle = L.circle([event.lat, event.lon], { radius: 0, color: '#ef3f7d', weight: 3, fillColor: '#ef3f7d', fillOpacity: .035, interactive: false }).addTo(eventLayer);
    }
    if (event.uncertaintyKm) {
      uncertaintyCircle = L.circle([event.lat, event.lon], { radius: event.uncertaintyKm * 1000, color: '#ff963e', dashArray: '5 7', weight: 1, fillColor: '#ff963e', fillOpacity: .035, interactive: false }).addTo(eventLayer);
    }
    if (pan) map.flyTo([event.lat, event.lon], Math.max(map.getZoom(), 5), { duration: .8 });
    updateTargetEta();
  }

  function renderStations(stations) {
    const present = new Set();
    stations.forEach(st => {
      present.add(st.key);
      let marker = stationMarkers.get(st.key);
      if (!marker) {
        marker = L.marker([st.lat, st.lon], { icon: stationIcon(st.online, st.triggered, st.latencyClass), keyboard: false });
        marker.bindTooltip(`${st.key} · ${(st.channels || [st.channel]).filter(Boolean).join('/')} · lat ${st.latencySeconds ?? '—'}s`, { className: 'station-tooltip', direction: 'top' });
        marker.addTo(stationLayer);
        stationMarkers.set(st.key, { marker, data: st });
      } else {
        marker.data = { ...marker.data, ...st };
        marker.marker.setIcon(stationIcon(marker.data.online, marker.data.triggered, marker.data.latencyClass));
      }
    });
    [...stationMarkers.keys()].forEach(key => {
      if (!present.has(key)) {
        stationLayer.removeLayer(stationMarkers.get(key).marker);
        stationMarkers.delete(key);
      }
    });
    refreshOnlineCount();
  }

  function patchStation(data) {
    const item = stationMarkers.get(data.key);
    if (!item) return;
    item.data = { ...item.data, ...data };
    item.marker.setIcon(stationIcon(item.data.online, item.data.triggered, item.data.latencyClass));
    refreshOnlineCount();
  }

  function refreshOnlineCount() {
    const now = Date.now();
    let online = 0;
    stationMarkers.forEach(item => {
      const last = item.data.lastReceived ? new Date(item.data.lastReceived).getTime() : (item.data.lastData ? new Date(item.data.lastData).getTime() : 0);
      const fresh = item.data.online && now - last < 90000;
      if (fresh) online += 1;
      if (item.data.online !== fresh) {
        item.data.online = fresh;
        item.marker.setIcon(stationIcon(fresh, item.data.triggered, item.data.latencyClass));
      }
    });
    els.onlineCount.textContent = online;
    const latencies = [];
    stationMarkers.forEach(item => { if (item.data.online && Number.isFinite(Number(item.data.latencySeconds))) latencies.push(Number(item.data.latencySeconds)); });
    latencies.sort((a,b) => a-b);
    const med = latencies.length ? latencies[Math.floor(latencies.length/2)] : null;
    els.medianLatency.textContent = med == null ? 'latência —' : `latência ${med.toFixed(1)}s`;
    els.mapNotice.classList.toggle('hidden', stationMarkers.size > 0);
    if (!stationMarkers.size) els.mapNotice.textContent = 'Aguardando metadados das estações…';
  }

  function renderSources(sources) {
    if (!sources || !sources.length) {
      els.sources.innerHTML = '<div class="empty-state">Inicializando fontes…</div>';
      return;
    }
    els.sources.innerHTML = sources.map(s => `
      <div class="source">
        <i class="${s.state || ''}"></i>
        <span>${s.label || s.key}</span>
        <small>${s.stationCount || 0} · ${s.state || '—'}</small>
      </div>`).join('');
  }

  function patchSource(source) {
    fetch('/api/state').then(r => r.json()).then(data => renderSources(data.sources)).catch(() => {});
  }

  function renderHistory(items) {
    history = [...(items || [])].sort((a,b) => (b.originEpoch || 0) - (a.originEpoch || 0)).slice(0,30);
    els.historyCount.textContent = `${history.length} evento${history.length === 1 ? '' : 's'}`;
    if (!history.length) {
      els.historyList.innerHTML = '<div class="empty-state">Nenhum evento recebido ainda.</div>';
      return;
    }
    els.historyList.innerHTML = history.map((e, i) => `
      <button class="history-item" data-index="${i}">
        <span class="history-mag">${e.magnitude != null ? Number(e.magnitude).toFixed(1) : '—'}</span>
        <div><strong>${e.status === 'catalog' ? 'Catálogo sísmico' : 'Detecção S.D.P'}</strong><small>${Number(e.lat).toFixed(2)}°, ${Number(e.lon).toFixed(2)}°</small></div>
        <span>${relativeTime(e.originEpoch)}</span>
      </button>`).join('');
    els.historyList.querySelectorAll('.history-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const e = history[Number(btn.dataset.index)];
        if (e) map.flyTo([e.lat, e.lon], 6, { duration: .8 });
      });
    });
  }

  function addOrUpdateHistory(event) {
    if (!event) return;
    const idx = history.findIndex(e => e.id === event.id);
    if (idx >= 0) history[idx] = { ...history[idx], ...event };
    else history.unshift(event);
    renderHistory(history);
  }

  function setTarget(lat, lon, label='Ponto selecionado') {
    target = { lat, lon, label };
    targetLayer.clearLayers();
    L.marker([lat,lon], { icon: targetIcon, zIndexOffset: 900 }).addTo(targetLayer);
    els.targetText.textContent = `${label}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    updateTargetEta();
  }

  function updateTargetEta() {
    if (!target || !currentEvent) {
      els.pEta.textContent = '—';
      els.sEta.textContent = '—';
      if (els.targetShindo) els.targetShindo.textContent = '—';
      return;
    }
    const d = haversine(currentEvent.lat, currentEvent.lon, target.lat, target.lon);
    const depth = Number(currentEvent.depthKm || 10);
    const hypo = Math.sqrt(d*d + depth*depth);
    const vp = Number(currentEvent.pVelocityKmS || 6.0);
    const vs = Number(currentEvent.sVelocityKmS || 3.5);
    const now = Date.now()/1000;
    const origin = Number(currentEvent.originEpoch || new Date(currentEvent.originTime).getTime()/1000);
    const pRemain = origin + hypo/vp - now;
    const sRemain = origin + hypo/vs - now;
    const fmt = seconds => seconds > 0 ? `${Math.ceil(seconds)} s` : `passou ${Math.abs(Math.floor(seconds))} s`;
    els.pEta.textContent = fmt(pRemain);
    els.sEta.textContent = fmt(sRemain);

    const targetProxy = shindoProxy(currentEvent, target.lat, target.lon);
    if (els.targetShindo) {
      els.targetShindo.textContent = targetProxy ? (targetProxy.level > 0 ? String(targetProxy.level) : '<1') : '—';
      els.targetShindo.title = targetProxy ? `PGA estimado ≈ ${targetProxy.pgaGal.toFixed(1)} gal · distância hipocentral ≈ ${targetProxy.distanceKm.toFixed(0)} km` : 'Aguardando magnitude';
    }
  }

  function animateWaves() {
    if (currentEvent && pCircle && sCircle && isWaveEventActive(currentEvent)) {
      const origin = Number(currentEvent.originEpoch || new Date(currentEvent.originTime).getTime()/1000);
      const elapsed = Math.max(0, Date.now()/1000 - origin);
      const pRadius = Math.min(4500, elapsed * Number(currentEvent.pVelocityKmS || 6.0)) * 1000;
      const sRadius = Math.min(4500, elapsed * Number(currentEvent.sVelocityKmS || 3.5)) * 1000;
      pCircle.setRadius(pRadius);
      sCircle.setRadius(sRadius);
      updateTargetEta();
    }
    requestAnimationFrame(animateWaves);
  }

  async function loadInitial() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      const data = await res.json();
      renderStations(data.stations || []);
      renderSources(data.sources || []);
      renderHistory(data.history || []);
      renderEvent(data.currentEvent || null, false);
      els.lastUpdate.textContent = 'estado sincronizado';
    } catch (err) {
      els.mapNotice.textContent = 'Backend indisponível. Tentando reconectar…';
    }
  }

  function connectWs() {
    clearTimeout(retryTimer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener('open', () => {
      els.linkStatus.classList.add('live');
      els.lastUpdate.textContent = 'WebSocket conectado';
      ws.send('hello');
    });
    ws.addEventListener('message', event => {
      els.lastUpdate.textContent = 'atualizado agora';
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'snapshot') {
        renderStations(msg.data.stations || []);
        renderSources(msg.data.sources || []);
        renderHistory(msg.data.history || []);
        renderEvent(msg.data.currentEvent || null, false);
      } else if (msg.type === 'station') {
        patchStation(msg.data);
      } else if (msg.type === 'source') {
        patchSource(msg.data);
      } else if (msg.type === 'event') {
        renderEvent(msg.data || null, Boolean(msg.data));
        if (msg.data) addOrUpdateHistory(msg.data);
      } else if (msg.type === 'history') {
        addOrUpdateHistory(msg.data);
      }
      if (ws.readyState === WebSocket.OPEN) ws.send('ack');
    });
    ws.addEventListener('close', () => {
      els.linkStatus.classList.remove('live');
      els.lastUpdate.textContent = 'reconectando';
      retryTimer = setTimeout(connectWs, 2500);
    });
    ws.addEventListener('error', () => ws.close());
  }

  map.on('click', e => setTarget(e.latlng.lat, e.latlng.lng));
  els.locateMe.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        setTarget(pos.coords.latitude, pos.coords.longitude, 'Minha localização');
        map.flyTo([pos.coords.latitude, pos.coords.longitude], Math.max(6, map.getZoom()), { duration: .8 });
      },
      () => { els.targetText.textContent = 'Não foi possível obter sua localização.'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
  els.clearTarget.addEventListener('click', () => {
    target = null;
    targetLayer.clearLayers();
    els.targetText.textContent = 'Clique no mapa para calcular a chegada estimada das ondas P e S.';
    updateTargetEta();
  });
  els.fitBrazil.addEventListener('click', () => map.fitBounds(BRAZIL_BOUNDS, { padding: [20,20] }));
  els.toggleStations.addEventListener('click', () => {
    stationVisible = !stationVisible;
    if (stationVisible) stationLayer.addTo(map); else map.removeLayer(stationLayer);
    els.toggleStations.classList.toggle('active', stationVisible);
  });

  setInterval(() => {
    refreshOnlineCount();
    if (currentEvent && target) updateTargetEta();
  }, 1000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  loadInitial();
  connectWs();
  animateWaves();
})();
