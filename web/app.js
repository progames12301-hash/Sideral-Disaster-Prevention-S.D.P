(() => {
  const BRAZIL_BOUNDS = [[-34.5, -74.5], [5.5, -34.0]];
  const map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 11, preferCanvas: true });
  map.fitBounds(BRAZIL_BOUNDS, { padding: [20, 20] });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const ids = [
    'linkStatus','alertStrip','alertHeadline','eventTime','eventLocation','eventCoordinates','magnitudeType','magnitudeValue',
    'eventStatus','depthValue','stationCount','confidence','rmsValue','uncertainty','phaseCount','pickLatency','azimuthalGap','revision',
    'eewMode','onlineCount','medianLatency','sources','targetText','pEta','sEta','historyCount','historyList','lastUpdate','mapNotice',
    'locateMe','clearTarget','fitBrazil','toggleStations','shindoValue','shindoMeta','shindoScale','targetShindo'
  ];
  const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

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

  const targetIcon = L.divIcon({
    className: '',
    html: '<div class="target-marker"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  const epicenterIcon = L.divIcon({
    className: '',
    html: '<div class="epicenter-marker"><span></span></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  function safe(v, fallback = '—') {
    return v === null || v === undefined || Number.isNaN(v) ? fallback : v;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371.0088;
    const toRad = d => d * Math.PI / 180;
    const p1 = toRad(lat1), p2 = toRad(lat2);
    const dlat = p2 - p1, dlon = toRad(lon2 - lon1);
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function formatUtc(epochOrIso) {
    const d = typeof epochOrIso === 'number' ? new Date(epochOrIso * 1000) : new Date(epochOrIso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      timeZone: 'UTC', hour12: false, day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + ' UTC';
  }

  function relativeTime(epoch) {
    if (!epoch) return '—';
    const sec = Math.round(Date.now() / 1000 - Number(epoch));
    if (sec < 0) return `em ${Math.abs(sec)} s`;
    if (sec < 60) return `${sec} s atrás`;
    if (sec < 3600) return `${Math.floor(sec / 60)} min atrás`;
    return `${Math.floor(sec / 3600)} h atrás`;
  }

  function stationActivityLevel(st) {
    const exact = Number(st?.activityLevel);
    if (Number.isFinite(exact)) return Math.max(0, Math.min(7, Math.round(exact)));

    const score = Number(st?.activityScore);
    if (Number.isFinite(score)) {
      const thresholds = [1.35, 1.70, 2.20, 3.00, 4.00, 6.175, 8.954];
      let level = 0;
      for (const threshold of thresholds) {
        if (score >= threshold) level += 1;
        else break;
      }
      return Math.max(0, Math.min(7, level));
    }

    let activity = Number(st?.activity ?? 0);
    if (!Number.isFinite(activity)) activity = 0;
    return Math.max(0, Math.min(7, Math.round(activity * 7)));
  }

  function stationIcon(st) {
    const level = stationActivityLevel(st);
    const online = st?.online ? 'online' : 'offline';
    const triggered = st?.triggered ? 'triggered' : '';
    const phase = String(st?.lastPhase || '').toUpperCase().startsWith('S') ? 'phase-s' : 'phase-p';
    return L.divIcon({
      className: '',
      html: `<div class="station-marker ${online} activity-${level} ${triggered} ${phase}"><span>${level}</span></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function stationTooltip(st) {
    const channels = (st.channels || [st.channel]).filter(Boolean).join('/');
    const level = stationActivityLevel(st);
    const score = Number(st.activityScore);
    const scoreText = Number.isFinite(score) ? ` · STA/LTA ${score.toFixed(2)}` : '';
    const phase = st.lastPhase ? ` · fase ${st.lastPhase}` : '';
    return `${st.key} · ${channels || 'canal —'} · nível ${level}/7${scoreText}${phase} · lat ${st.latencySeconds ?? '—'}s`;
  }

  function findCatalogMatch(event) {
    if (!event?.originEpoch) return null;
    let best = null;
    let bestScore = Infinity;
    for (const item of history) {
      if (!item || item.status !== 'catalog' || item.magnitude == null || item.originEpoch == null) continue;
      const dt = Math.abs(Number(item.originEpoch) - Number(event.originEpoch));
      if (dt > 180) continue;
      const distance = haversine(Number(event.lat), Number(event.lon), Number(item.lat), Number(item.lon));
      if (!Number.isFinite(distance) || distance > 180) continue;
      const score = dt + distance / 3;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  function effectiveEvent(event) {
    if (!event) return null;
    const match = findCatalogMatch(event);
    if (!match) return event;
    return {
      ...event,
      magnitude: event.magnitude ?? match.magnitude,
      magnitudeType: event.magnitudeType ?? match.magnitudeType,
      depthKm: match.depthKm ?? event.depthKm,
      depthResolved: match.depthKm != null ? true : event.depthResolved,
      catalogDisplayMatch: true
    };
  }

  function shindoProxy(event, lat, lon) {
    if (!event || event.magnitude == null) return null;
    const magnitude = Number(event.magnitude);
    const eventLat = Number(event.lat), eventLon = Number(event.lon);
    if (![magnitude, eventLat, eventLon].every(Number.isFinite)) return null;
    const surfaceKm = haversine(eventLat, eventLon, Number(lat), Number(lon));
    const depthKm = Math.max(0, Number(event.depthKm ?? 10));
    const rKm = Math.max(1, Math.sqrt(surfaceKm ** 2 + depthKm ** 2));
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
    if (!event || event.magnitude == null) {
      if (els.shindoValue) els.shindoValue.textContent = '—';
      if (els.shindoMeta) els.shindoMeta.textContent = 'Aguardando magnitude';
      return;
    }
    const proxy = shindoProxy(event, event.lat, event.lon);
    if (!proxy) return;
    if (els.shindoValue) els.shindoValue.textContent = proxy.level > 0 ? String(proxy.level) : '<1';
    if (els.shindoMeta) els.shindoMeta.textContent = `estimativa · PGA ≈ ${proxy.pgaGal.toFixed(proxy.pgaGal < 10 ? 1 : 0)} gal`;
    steps.forEach(step => {
      const value = Number(step.dataset.shindo);
      if (proxy.level > 0 && value < proxy.level) step.classList.add('passed');
      if (value === proxy.level) step.classList.add('active');
    });
  }

  function originEpoch(event) {
    const value = Number(event?.originEpoch ?? new Date(event?.originTime).getTime() / 1000);
    return Number.isFinite(value) ? value : null;
  }

  function isWaveEventActive(event) {
    if (!event || event.waveEligible !== true) return false;
    const origin = originEpoch(event);
    if (origin == null) return false;
    const age = Date.now() / 1000 - origin;
    return age >= -3 && age <= 420;
  }

  function surfaceWaveRadiusKm(elapsedSeconds, velocityKmS, depthKm) {
    const travelled = Math.max(0, elapsedSeconds) * Math.max(0.1, velocityKmS);
    const depth = Math.max(0, depthKm);
    if (travelled <= depth) return 0;
    return Math.sqrt(Math.max(0, travelled ** 2 - depth ** 2));
  }

  function eventName(event) {
    if (!event) return 'Sem evento ativo';
    if (event.status === 'catalog_confirmed') return 'Evento confirmado no catálogo';
    return 'Hipocentro preliminar';
  }

  function clearEventGraphics() {
    eventLayer.clearLayers();
    pCircle = null;
    sCircle = null;
    uncertaintyCircle = null;
    epicenterMarker = null;
  }

  function renderEvent(rawEvent, pan = false) {
    currentEvent = rawEvent;
    const event = effectiveEvent(rawEvent);

    if (!event) {
      els.alertStrip.classList.remove('active');
      els.alertHeadline.textContent = 'Rede sísmica em observação';
      els.eventTime.textContent = 'Aguardando detecção multiestação';
      els.eventLocation.textContent = 'Sem evento ativo';
      els.eventCoordinates.textContent = '—';
      els.magnitudeValue.textContent = '—';
      els.magnitudeType.textContent = 'aguardando evento';
      els.depthValue.textContent = '—';
      els.eventStatus.textContent = 'aguardando hipocentro';
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
      clearEventGraphics();
      return;
    }

    const lat = Number(event.lat), lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    els.alertStrip.classList.add('active');
    els.alertHeadline.textContent = event.status === 'catalog_confirmed'
      ? 'Evento associado ao catálogo'
      : (event.eewEligible ? 'Possível evento sísmico detectado' : 'Hipocentro validado · sem EEW');
    els.eventTime.textContent = formatUtc(originEpoch(event) ?? event.originTime);
    els.eventLocation.textContent = eventName(event);
    els.eventCoordinates.textContent = `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;

    const mag = Number(event.magnitude);
    if (Number.isFinite(mag)) {
      els.magnitudeValue.textContent = mag.toFixed(1);
      els.magnitudeType.textContent = event.magnitudeType || (event.catalogDisplayMatch ? 'catálogo USP' : 'magnitude');
    } else {
      els.magnitudeValue.textContent = '…';
      els.magnitudeType.textContent = 'aguardando magnitude calibrada';
    }

    const depth = Number(event.depthKm);
    if (Number.isFinite(depth)) {
      els.depthValue.textContent = `${event.depthResolved === false ? '≈' : ''}${depth.toFixed(0)}`;
      els.eventStatus.textContent = event.depthResolved === false ? 'profundidade preliminar' : 'profundidade resolvida';
    } else {
      els.depthValue.textContent = '…';
      els.eventStatus.textContent = 'calculando profundidade';
    }

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
    } else if (event.waveEligible) {
      els.eewMode.textContent = 'EEW · P/S LIBERADAS';
      els.eewMode.className = 'eew-mode eligible';
    } else {
      els.eewMode.textContent = 'HIPOCENTRO · ONDAS BLOQUEADAS';
      els.eewMode.className = 'eew-mode late';
    }

    renderShindo(event);
    clearEventGraphics();

    epicenterMarker = L.marker([lat, lon], { icon: epicenterIcon, zIndexOffset: 1500 }).addTo(eventLayer);
    epicenterMarker.bindTooltip(
      event.status === 'catalog_confirmed' ? 'Epicentro confirmado' : `Hipocentro preliminar · rev ${event.revision ?? '—'}`,
      { className: 'station-tooltip', direction: 'top' }
    );

    if (isWaveEventActive(event)) {
      pCircle = L.circle([lat, lon], {
        radius: 0, color: '#38bdf8', weight: 2, opacity: 0.95, fill: false, interactive: false, className: 'wavefront wavefront-p'
      }).addTo(eventLayer);
      sCircle = L.circle([lat, lon], {
        radius: 0, color: '#ff3b68', weight: 3, opacity: 0.95, fill: false, interactive: false, className: 'wavefront wavefront-s'
      }).addTo(eventLayer);
    }

    if (Number(event.uncertaintyKm) > 0) {
      uncertaintyCircle = L.circle([lat, lon], {
        radius: Number(event.uncertaintyKm) * 1000,
        color: '#ff963e', dashArray: '5 7', weight: 1, opacity: 0.65, fill: false, interactive: false
      }).addTo(eventLayer);
    }

    if (pan) map.flyTo([lat, lon], Math.max(map.getZoom(), 5), { duration: 0.7 });
    updateTargetEta();
  }

  function upsertStation(st) {
    if (!st || !Number.isFinite(Number(st.lat)) || !Number.isFinite(Number(st.lon))) return;
    let item = stationMarkers.get(st.key);
    if (!item) {
      const marker = L.marker([Number(st.lat), Number(st.lon)], { icon: stationIcon(st), keyboard: false }).addTo(stationLayer);
      marker.bindTooltip(stationTooltip(st), { className: 'station-tooltip', direction: 'top' });
      item = { marker, data: { ...st } };
      stationMarkers.set(st.key, item);
    } else {
      item.data = { ...item.data, ...st };
      item.marker.setIcon(stationIcon(item.data));
      item.marker.setTooltipContent(stationTooltip(item.data));
    }
  }

  function renderStations(stations) {
    const present = new Set();
    for (const st of stations || []) {
      present.add(st.key);
      upsertStation(st);
    }
    for (const key of [...stationMarkers.keys()]) {
      if (!present.has(key)) {
        stationLayer.removeLayer(stationMarkers.get(key).marker);
        stationMarkers.delete(key);
      }
    }
    refreshOnlineCount();
  }

  function patchStation(data) {
    const item = stationMarkers.get(data?.key);
    if (!item) return;
    upsertStation({ ...item.data, ...data });
    refreshOnlineCount();
  }

  function refreshOnlineCount() {
    const now = Date.now();
    let online = 0;
    const latencies = [];
    stationMarkers.forEach(item => {
      const last = item.data.lastReceived ? new Date(item.data.lastReceived).getTime() : 0;
      const fresh = Boolean(item.data.online) && last > 0 && now - last < 90000;
      if (fresh) online += 1;
      if (item.data.online !== fresh) {
        item.data.online = fresh;
        item.marker.setIcon(stationIcon(item.data));
      }
      if (fresh && Number.isFinite(Number(item.data.latencySeconds))) latencies.push(Number(item.data.latencySeconds));
    });
    latencies.sort((a, b) => a - b);
    const med = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
    els.onlineCount.textContent = String(online);
    els.medianLatency.textContent = med == null ? 'latência —' : `latência ${med.toFixed(1)}s`;
    els.mapNotice.classList.toggle('hidden', stationMarkers.size > 0);
  }

  function renderSources(sources) {
    if (!sources?.length) {
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

  function patchSource() {
    fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(data => renderSources(data.sources || [])).catch(() => {});
  }

  function renderHistory(items) {
    history = [...(items || [])].sort((a, b) => Number(b.originEpoch || 0) - Number(a.originEpoch || 0)).slice(0, 30);
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
        if (e) map.flyTo([e.lat, e.lon], 6, { duration: 0.7 });
      });
    });
  }

  function addOrUpdateHistory(event) {
    if (!event) return;
    const idx = history.findIndex(e => e.id === event.id);
    if (idx >= 0) history[idx] = { ...history[idx], ...event };
    else history.unshift(event);
    renderHistory(history);
    if (currentEvent) renderEvent(currentEvent, false);
  }

  function setTarget(lat, lon, label = 'Ponto selecionado') {
    target = { lat, lon, label };
    targetLayer.clearLayers();
    L.marker([lat, lon], { icon: targetIcon, zIndexOffset: 900 }).addTo(targetLayer);
    els.targetText.textContent = `${label}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    updateTargetEta();
  }

  function updateTargetEta() {
    const event = effectiveEvent(currentEvent);
    if (!target || !event) {
      els.pEta.textContent = '—';
      els.sEta.textContent = '—';
      if (els.targetShindo) els.targetShindo.textContent = '—';
      return;
    }
    const d = haversine(event.lat, event.lon, target.lat, target.lon);
    const depth = Math.max(0, Number(event.depthKm ?? 10));
    const hypo = Math.sqrt(d ** 2 + depth ** 2);
    const vp = Math.max(0.1, Number(event.pVelocityKmS || 6.0));
    const vs = Math.max(0.1, Number(event.sVelocityKmS || 3.5));
    const origin = originEpoch(event);
    if (origin == null) return;
    const now = Date.now() / 1000;
    const fmt = seconds => seconds > 0 ? `${Math.ceil(seconds)} s` : `passou ${Math.abs(Math.floor(seconds))} s`;
    els.pEta.textContent = fmt(origin + hypo / vp - now);
    els.sEta.textContent = fmt(origin + hypo / vs - now);
    const proxy = shindoProxy(event, target.lat, target.lon);
    if (els.targetShindo) els.targetShindo.textContent = proxy ? (proxy.level > 0 ? String(proxy.level) : '<1') : '—';
  }

  function animateWaves() {
    const event = effectiveEvent(currentEvent);
    if (event && pCircle && sCircle && isWaveEventActive(event)) {
      const origin = originEpoch(event);
      const elapsed = Math.max(0, Date.now() / 1000 - origin);
      const depth = Math.max(0, Number(event.depthKm ?? 10));
      const vp = Math.max(0.1, Number(event.pVelocityKmS || 6.0));
      const vs = Math.max(0.1, Number(event.sVelocityKmS || 3.5));
      const pRadius = Math.min(4500, surfaceWaveRadiusKm(elapsed, vp, depth)) * 1000;
      const sRadius = Math.min(4500, surfaceWaveRadiusKm(elapsed, vs, depth)) * 1000;
      pCircle.setRadius(pRadius);
      sCircle.setRadius(sRadius);
      updateTargetEta();
    }
    requestAnimationFrame(animateWaves);
  }

  async function loadInitial() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderStations(data.stations || []);
      renderSources(data.sources || []);
      renderHistory(data.history || []);
      renderEvent(data.currentEvent || null, false);
      els.lastUpdate.textContent = 'estado sincronizado';
    } catch {
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
      try { ws.send('hello'); } catch {}
    });
    ws.addEventListener('message', message => {
      let msg;
      try { msg = JSON.parse(message.data); } catch { return; }
      els.lastUpdate.textContent = 'atualizado agora';
      if (msg.type === 'snapshot') {
        renderStations(msg.data.stations || []);
        renderSources(msg.data.sources || []);
        renderHistory(msg.data.history || []);
        renderEvent(msg.data.currentEvent || null, false);
      } else if (msg.type === 'station') patchStation(msg.data);
      else if (msg.type === 'source') patchSource(msg.data);
      else if (msg.type === 'event') {
        renderEvent(msg.data || null, Boolean(msg.data));
        if (msg.data) addOrUpdateHistory(msg.data);
      } else if (msg.type === 'history') addOrUpdateHistory(msg.data);
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send('ack'); } catch {}
      }
    });
    ws.addEventListener('close', () => {
      els.linkStatus.classList.remove('live');
      els.lastUpdate.textContent = 'reconectando';
      retryTimer = setTimeout(connectWs, 2500);
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
  }

  map.on('click', e => setTarget(e.latlng.lat, e.latlng.lng));
  els.locateMe.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        setTarget(pos.coords.latitude, pos.coords.longitude, 'Minha localização');
        map.flyTo([pos.coords.latitude, pos.coords.longitude], Math.max(6, map.getZoom()), { duration: 0.7 });
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
  els.fitBrazil.addEventListener('click', () => map.fitBounds(BRAZIL_BOUNDS, { padding: [20, 20] }));
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
