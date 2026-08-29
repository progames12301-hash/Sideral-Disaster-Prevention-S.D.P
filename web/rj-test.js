(() => {
  if (!window.L) return;

  const TEST_CENTER = [-22.98, -43.28];
  const TEST_DURATION_MS = 42000;
  const NORMAL_WAVE_MAX_METERS = 1_200_000;
  const capturedStationMarkers = new Set();
  let capturedMap = null;
  let running = false;
  let timers = [];
  let animationFrame = null;
  let paintInterval = null;
  let testLayer = null;
  let chosen = [];
  let syntheticStates = [];

  const nativeMap = L.map.bind(L);
  const nativeMarker = L.marker.bind(L);
  const nativeCircle = L.circle.bind(L);

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

  // Display safety net only. The backend still controls waveEligible. A stale/false
  // experimental candidate must not paint continent-sized rings on the public map.
  L.circle = (latlng, options = {}) => {
    const circle = nativeCircle(latlng, options);
    const className = String(options?.className || '');
    if (className.includes('wavefront')) {
      const nativeSetRadius = circle.setRadius.bind(circle);
      circle.setRadius = radius => nativeSetRadius(
        Math.max(0, Math.min(NORMAL_WAVE_MAX_METERS, Number(radius) || 0))
      );
    }
    return circle;
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const r = 6371.0088;
    const rad = n => n * Math.PI / 180;
    const p1 = rad(lat1), p2 = rad(lat2);
    const dp = p2 - p1, dl = rad(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function stationTestIcon(level, phase = 'P', triggered = false) {
    const safeLevel = Math.max(0, Math.min(6, level));
    return L.divIcon({
      className: '',
      html: `<div class="station-marker online activity-${safeLevel} ${triggered ? 'triggered' : ''} ${phase === 'S' ? 'phase-s' : 'phase-p'} test-station"></div>`,
      iconSize: [11, 11],
      iconAnchor: [5.5, 5.5]
    });
  }

  function selectRJStations() {
    const markers = [...capturedStationMarkers].filter(marker => {
      try {
        const p = marker.getLatLng();
        return Number.isFinite(p.lat) && Number.isFinite(p.lng);
      } catch {
        return false;
      }
    });

    let rj = markers.filter(marker => {
      const p = marker.getLatLng();
      return p.lat >= -24.8 && p.lat <= -20.0 && p.lng >= -46.5 && p.lng <= -40.0;
    });

    const nearest = list => list
      .map(marker => {
        const p = marker.getLatLng();
        return { marker, d: haversine(TEST_CENTER[0], TEST_CENTER[1], p.lat, p.lng) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.min(7, list.length))
      .map(item => item.marker);

    if (rj.length < 7) rj = nearest(markers);
    else rj = nearest(rj);
    return rj;
  }

  function applySyntheticStation(index) {
    const marker = chosen[index];
    const state = syntheticStates[index];
    if (!marker || !state) return;
    marker.setIcon(stationTestIcon(state.level, state.phase, state.triggered));
  }

  function paintStation(index, level, phase = 'P', triggered = false) {
    syntheticStates[index] = { level, phase, triggered };
    applySyntheticStation(index);
  }

  function putText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function setTestPanel(revision, pPicks, sPicks) {
    const strip = byId('alertStrip');
    if (strip) strip.classList.add('active', 'test-mode');
    putText('alertHeadline', 'SIMULAÇÃO RJ — NÃO É EVENTO REAL');
    putText('eventTime', new Date().toLocaleTimeString('pt-BR', { hour12: false }) + ' · teste local');
    putText('eventLocation', 'Simulação — região do Rio de Janeiro');
    putText('eventCoordinates', `${TEST_CENTER[0].toFixed(3)}°, ${TEST_CENTER[1].toFixed(3)}°`);
    putText('magnitudeValue', '3.8');
    putText('magnitudeType', 'SIMULAÇÃO');
    putText('depthValue', '12');
    putText('eventStatus', 'profundidade de teste');
    putText('stationCount', String(chosen.length));
    putText('confidence', '97%');
    putText('rmsValue', '0.4s');
    putText('uncertainty', '±18 km');
    putText('phaseCount', `${pPicks} / ${sPicks}`);
    putText('pickLatency', '1.1s');
    putText('azimuthalGap', '148°');
    putText('revision', `#${revision}`);
    putText('shindoValue', '3');
    putText('shindoMeta', 'SIMULAÇÃO · não instrumental');

    const mode = byId('eewMode');
    if (mode) {
      mode.textContent = 'MODO TESTE RJ · P/S SIMULADAS';
      mode.className = 'eew-mode test';
    }
    document.querySelectorAll('.shindo-step').forEach(step => {
      const n = Number(step.dataset.shindo);
      step.classList.toggle('passed', n < 3);
      step.classList.toggle('active', n === 3);
    });
  }

  function makeTestOverlay() {
    if (!capturedMap) return;
    testLayer = L.layerGroup().addTo(capturedMap);

    const icon = L.divIcon({
      className: '',
      html: '<div class="epicenter-marker test-epicenter"><span></span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    nativeMarker(TEST_CENTER, { icon, zIndexOffset: 3000 })
      .bindTooltip('SIMULAÇÃO — epicentro de teste', { direction: 'top' })
      .addTo(testLayer);

    nativeCircle(TEST_CENTER, {
      radius: 18000,
      color: '#ffb13b',
      weight: 1,
      dashArray: '5 7',
      opacity: 0.8,
      fill: false,
      interactive: false
    }).addTo(testLayer);

    const p = nativeCircle(TEST_CENTER, {
      radius: 0,
      color: '#38bdf8',
      weight: 2,
      opacity: 0.95,
      fill: false,
      interactive: false,
      className: 'wavefront wavefront-p test-wave'
    }).addTo(testLayer);
    const s = nativeCircle(TEST_CENTER, {
      radius: 0,
      color: '#ff3b68',
      weight: 3,
      opacity: 0.95,
      fill: false,
      interactive: false,
      className: 'wavefront wavefront-s test-wave'
    }).addTo(testLayer);

    const origin = performance.now();
    const depthKm = 12;
    function surfaceRadius(elapsedSec, velocity) {
      const travelled = Math.max(0, elapsedSec) * velocity;
      if (travelled <= depthKm) return 0;
      return Math.sqrt(travelled ** 2 - depthKm ** 2);
    }
    function frame(now) {
      if (!running) return;
      const elapsed = Math.max(0, (now - origin) / 1000);
      p.setRadius(Math.min(260, surfaceRadius(elapsed, 6.0)) * 1000);
      s.setRadius(Math.min(180, surfaceRadius(elapsed, 3.5)) * 1000);
      animationFrame = requestAnimationFrame(frame);
    }
    animationFrame = requestAnimationFrame(frame);
  }

  function schedule(ms, fn) {
    timers.push(setTimeout(() => {
      if (running) fn();
    }, ms));
  }

  function stopTest() {
    if (!running) return;
    running = false;
    timers.forEach(clearTimeout);
    timers = [];
    if (paintInterval) clearInterval(paintInterval);
    paintInterval = null;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (testLayer && capturedMap) capturedMap.removeLayer(testLayer);
    testLayer = null;
    location.reload();
  }

  function startTest() {
    if (running) {
      stopTest();
      return;
    }
    if (!capturedMap) return;
    chosen = selectRJStations();
    if (chosen.length < 3) {
      const notice = byId('mapNotice');
      if (notice) {
        notice.classList.remove('hidden');
        notice.textContent = 'Teste RJ aguardando pelo menos 3 estações carregadas.';
      }
      return;
    }

    running = true;
    syntheticStates = [];
    document.body.classList.add('sdp-test-running');
    const button = byId('testRJ');
    if (button) {
      button.textContent = 'PARAR TESTE';
      button.classList.add('running');
    }

    const badge = document.createElement('div');
    badge.className = 'test-mode-badge';
    badge.id = 'testModeBadge';
    badge.textContent = 'SIMULAÇÃO RJ · DADOS NÃO REAIS';
    document.querySelector('.map-shell')?.appendChild(badge);

    // Live WebSocket station messages may continue arriving while the local test runs.
    // Re-apply only the chosen synthetic markers; no backend data is changed.
    paintInterval = setInterval(() => {
      if (!running) return;
      syntheticStates.forEach((_, index) => applySyntheticStation(index));
    }, 180);

    // Stage 1: actual mapped station positions around RJ react first; no epicenter exists yet.
    paintStation(0, 2);
    paintStation(1, 1);
    schedule(700, () => {
      paintStation(0, 4, 'P', true);
      paintStation(1, 3, 'P', true);
      paintStation(2, 2, 'P', false);
    });
    schedule(1500, () => {
      paintStation(2, 4, 'P', true);
      paintStation(3, 3, 'P', true);
      paintStation(4, 2, 'P', false);
    });

    // The synthetic hypocenter is released only after the visible multi-station sequence.
    schedule(2600, () => {
      paintStation(4, 4, 'P', true);
      paintStation(5, 3, 'P', true);
      paintStation(6, 2, 'P', false);
      setTestPanel(1, Math.min(6, chosen.length), 0);
      makeTestOverlay();
      capturedMap.flyTo(TEST_CENTER, Math.max(6, capturedMap.getZoom()), { duration: 0.7 });
    });
    schedule(5200, () => {
      chosen.forEach((_, i) => paintStation(i, i < 3 ? 5 : 4, i < 2 ? 'S' : 'P', true));
      setTestPanel(2, Math.min(7, chosen.length), Math.min(2, chosen.length));
    });
    schedule(8500, () => {
      chosen.forEach((_, i) => paintStation(i, i < 2 ? 4 : 2, 'S', i < 4));
      setTestPanel(3, Math.min(7, chosen.length), Math.min(5, chosen.length));
    });
    schedule(14000, () => {
      chosen.forEach((_, i) => paintStation(i, i < 2 ? 2 : 1, 'S', false));
    });
    schedule(TEST_DURATION_MS, stopTest);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const button = byId('testRJ');
    if (button) button.addEventListener('click', startTest);
  });
})();
