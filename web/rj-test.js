(() => {
  if (!window.L) return;

  const capturedStationMarkers = new Set();
  let capturedMap = null;
  let running = false;
  let timers = [];
  let testLayer = null;
  let animationFrame = null;
  let selectedKeys = new Set();

  const nativeMap = L.map.bind(L);
  const nativeMarker = L.marker.bind(L);
  const nativeCircle = L.circle.bind(L);

  // app.js creates the real Leaflet map after this file loads. Capture it without replacing it.
  L.map = (...args) => {
    const map = nativeMap(...args);
    capturedMap = map;
    return map;
  };

  L.marker = (latlng, options = {}) => {
    const marker = nativeMarker(latlng, options);
    const html = String(options?.icon?.options?.html || '');
    if (html.includes('station-marker')) capturedStationMarkers.add(marker);
    return marker;
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function stationKey(marker) {
    try {
      const content = String(marker.getTooltip()?.getContent?.() || '');
      return content.split(' · ')[0].trim();
    } catch {
      return '';
    }
  }

  function markerIndex() {
    const result = new Map();
    for (const marker of capturedStationMarkers) {
      const key = stationKey(marker);
      if (key) result.set(key, marker);
    }
    return result;
  }

  function testStationIcon(level, triggered = false) {
    const safeLevel = Math.max(0, Math.min(7, Math.round(Number(level) || 0)));
    return L.divIcon({
      className: '',
      html: `<div class="station-marker online activity-${safeLevel} ${triggered ? 'triggered' : ''} test-station"><span>${safeLevel}</span></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function badge(text) {
    let el = byId('testModeBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'testModeBadge';
      el.className = 'test-mode-badge';
      document.querySelector('.map-shell')?.appendChild(el);
    }
    el.textContent = text;
  }

  function put(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function resetShindo() {
    put('shindoValue', '—');
    put('shindoMeta', 'sem magnitude calibrada');
    document.querySelectorAll('.shindo-step').forEach(step => step.classList.remove('active', 'passed'));
  }

  function surfaceRadius(elapsedSec, velocity, depthKm) {
    const travelled = Math.max(0, elapsedSec) * Math.max(0.1, Number(velocity) || 0.1);
    const depth = Math.max(0, Number(depthKm) || 0);
    if (travelled <= depth) return 0;
    return Math.sqrt(Math.max(0, travelled ** 2 - depth ** 2));
  }

  function stopWaveAnimation() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function drawDerivedEvent(event) {
    if (!capturedMap || !event) return;
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (testLayer) capturedMap.removeLayer(testLayer);
    testLayer = L.layerGroup().addTo(capturedMap);
    stopWaveAnimation();

    const icon = L.divIcon({
      className: '',
      html: '<div class="epicenter-marker test-epicenter"><span></span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    nativeMarker([lat, lon], { icon, zIndexOffset: 3100 })
      .bindTooltip(`SIMULAÇÃO · hipocentro calculado · rev ${event.revision ?? '—'}`, { direction: 'top' })
      .addTo(testLayer);

    const uncertaintyKm = Number(event.uncertaintyKm);
    if (Number.isFinite(uncertaintyKm) && uncertaintyKm > 0) {
      nativeCircle([lat, lon], {
        radius: Math.min(180, uncertaintyKm) * 1000,
        color: '#ffb13b',
        weight: 1,
        dashArray: '5 7',
        opacity: 0.82,
        fill: false,
        interactive: false
      }).addTo(testLayer);
    }

    if (event.waveEligible !== true) return;

    const p = nativeCircle([lat, lon], {
      radius: 0,
      color: '#38bdf8',
      weight: 2,
      opacity: 0.95,
      fill: false,
      interactive: false,
      className: 'wavefront wavefront-p test-wave'
    }).addTo(testLayer);
    const s = nativeCircle([lat, lon], {
      radius: 0,
      color: '#ff3b68',
      weight: 3,
      opacity: 0.95,
      fill: false,
      interactive: false,
      className: 'wavefront wavefront-s test-wave'
    }).addTo(testLayer);

    const depth = Math.max(0, Number(event.depthKm) || 10);
    const vp = Math.max(0.1, Number(event.pVelocityKmS) || 6.0);
    const vs = Math.max(0.1, Number(event.sVelocityKmS) || 3.5);
    const presentationStart = performance.now();

    function frame(now) {
      if (!running) return;
      const elapsed = Math.max(0, (now - presentationStart) / 1000);
      // Test display is intentionally local. It never draws continent-sized fronts.
      p.setRadius(Math.min(280, surfaceRadius(elapsed, vp, depth)) * 1000);
      s.setRadius(Math.min(190, surfaceRadius(elapsed, vs, depth)) * 1000);
      animationFrame = requestAnimationFrame(frame);
    }
    animationFrame = requestAnimationFrame(frame);
  }

  function renderDerivedEvent(event) {
    const strip = byId('alertStrip');
    if (strip) strip.classList.add('active', 'test-mode');
    put('alertHeadline', 'SIMULAÇÃO RJ — RESULTADO DO DETECTOR');
    put('eventTime', `origem calculada · revisão #${event.revision ?? '—'}`);
    put('eventLocation', 'Hipocentro calculado pelo pipeline');
    put('eventCoordinates', `${Number(event.lat).toFixed(3)}°, ${Number(event.lon).toFixed(3)}°`);

    if (event.magnitude == null) {
      put('magnitudeValue', '—');
      put('magnitudeType', 'não injetada · requer calibração');
      resetShindo();
    } else {
      put('magnitudeValue', Number(event.magnitude).toFixed(1));
      put('magnitudeType', event.magnitudeType || 'calculada');
    }

    const depth = Number(event.depthKm);
    put('depthValue', Number.isFinite(depth) ? `${event.depthResolved === false ? '≈' : ''}${depth.toFixed(0)}` : '—');
    put('eventStatus', event.depthResolved === false ? 'profundidade preliminar calculada' : 'profundidade calculada');
    put('stationCount', event.stationCount ?? '—');
    put('confidence', event.confidence != null ? `${event.confidence}%` : '—');
    put('rmsValue', event.rmsSeconds != null ? `${event.rmsSeconds}s` : '—');
    put('uncertainty', event.uncertaintyKm != null ? `±${event.uncertaintyKm} km` : '—');
    put('phaseCount', `${event.phaseCounts?.P ?? 0} / ${event.phaseCounts?.S ?? 0}`);
    put('pickLatency', event.medianPickLatencySeconds != null ? `${Number(event.medianPickLatencySeconds).toFixed(1)}s` : '—');
    put('azimuthalGap', event.azimuthalGap != null ? `${Number(event.azimuthalGap).toFixed(0)}°` : '—');
    put('revision', event.revision != null ? `#${event.revision}` : '—');

    const mode = byId('eewMode');
    if (mode) {
      mode.textContent = event.waveEligible
        ? 'TESTE · P/S LIBERADAS PELO PIPELINE'
        : 'TESTE · HIPOCENTRO OK · ONDAS BLOQUEADAS';
      mode.className = `eew-mode test ${event.waveEligible ? 'eligible' : 'late'}`;
    }

    drawDerivedEvent(event);
    capturedMap?.flyTo([Number(event.lat), Number(event.lon)], Math.max(6, capturedMap.getZoom()), { duration: 0.7 });
  }

  function renderFailure(payload) {
    const strip = byId('alertStrip');
    if (strip) strip.classList.add('active', 'test-mode');
    put('alertHeadline', 'TESTE RJ — DETECTOR NÃO FORMOU HIPOCENTRO');
    put('eventTime', 'nenhum valor foi forçado');
    put('eventLocation', 'Teste end-to-end falhou');
    put('eventCoordinates', '—');
    put('magnitudeValue', '—');
    put('magnitudeType', 'não injetada');
    put('depthValue', '—');
    put('eventStatus', 'sem solução automática');
    put('stationCount', payload?.selectedStations?.length ?? '—');
    put('confidence', '—');
    put('rmsValue', '—');
    put('uncertainty', '—');
    put('phaseCount', `${payload?.pickCount ?? 0} / 0`);
    put('revision', '—');
    put('eewMode', 'TESTE FALHOU · SEM EPICENTRO FORÇADO');
    resetShindo();
  }

  function installStationGuards(stations) {
    const index = markerIndex();
    selectedKeys = new Set((stations || []).map(st => st.key));
    for (const key of selectedKeys) {
      const marker = index.get(key);
      if (!marker || marker.__sdpTestGuarded) continue;
      const nativeSetIcon = marker.setIcon.bind(marker);
      marker.__sdpTestNativeSetIcon = nativeSetIcon;
      marker.__sdpTestGuarded = true;
      marker.setIcon = icon => {
        if (running) {
          marker.__sdpDeferredIcon = icon;
          return marker;
        }
        return nativeSetIcon(icon);
      };
    }
  }

  function applyStationFrame(data) {
    if (!data?.key || !selectedKeys.has(data.key)) return;
    const marker = markerIndex().get(data.key);
    if (!marker) return;
    const level = Math.max(0, Math.min(7, Math.round(Number(data.activityLevel) || 0)));
    const icon = testStationIcon(level, Boolean(data.triggered));
    const setter = marker.__sdpTestNativeSetIcon || marker.setIcon.bind(marker);
    setter(icon);
    try {
      marker.setTooltipContent(`${data.key} · TESTE WAVEFORM · nível ${level}/7 · STA/LTA ${Number(data.activityScore || 0).toFixed(2)}`);
    } catch {}
  }

  function schedule(ms, fn) {
    timers.push(setTimeout(() => {
      if (running) fn();
    }, Math.max(0, ms)));
  }

  function finishAfter(ms) {
    schedule(ms, () => {
      badge('SIMULAÇÃO ENCERRADA · restaurando dados reais');
      schedule(1800, () => location.reload());
    });
  }

  function replay(payload) {
    installStationGuards(payload.selectedStations || []);
    badge('SIMULAÇÃO RJ · WAVEFORM BRUTO → DETECTOR REAL');

    const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    let maxMs = 0;
    for (const row of timeline) {
      const atMs = Math.max(0, Number(row.atMs) || 0);
      maxMs = Math.max(maxMs, atMs);
      if (row.type === 'station') schedule(atMs, () => applyStationFrame(row.data));
      if (row.type === 'event') schedule(atMs, () => renderDerivedEvent(row.data));
    }

    if (!payload.derivedEvent) {
      schedule(maxMs + 400, () => renderFailure(payload));
    }
    finishAfter(maxMs + 9000);
  }

  async function startTest() {
    if (running) return;
    running = true;
    document.body.classList.add('sdp-test-running');
    const button = byId('testRJ');
    if (button) {
      button.disabled = true;
      button.textContent = 'PROCESSANDO…';
      button.classList.add('running');
    }
    badge('TESTE RJ · gerando somente waveforms nas estações…');

    try {
      const response = await fetch('/api/test/rj', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.detail || `HTTP ${response.status}`);
      if (button) button.textContent = 'TESTE EM EXECUÇÃO';
      replay(payload);
    } catch (error) {
      badge(`TESTE RJ FALHOU · ${String(error?.message || error).slice(0, 90)}`);
      renderFailure({ pickCount: 0, selectedStations: [] });
      finishAfter(6500);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const button = byId('testRJ');
    if (button) {
      button.title = 'Teste end-to-end: injeta somente waveform sintético em estações reais do RJ; epicentro/profundidade não são pré-definidos para o detector';
      button.addEventListener('click', startTest);
    }
  });
})();
