(() => {
  const isGithubPages = location.hostname.endsWith('.github.io');
  const params = new URLSearchParams(location.search);
  const queryApi = params.get('api');
  const storedApi = localStorage.getItem('sdp-api-base');
  const defaultRender = 'https://sideral-disaster-prevention.onrender.com';

  function normalize(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  // A single STA/LTA peak can be very high even when it lasts only a fraction of a
  // second. The detector already requires a sustained onset before `triggered=true`;
  // mirror that rule in the map so short cultural/noise spikes cannot flash 6 or 7.
  // Levels 6-7 are therefore reserved for stations that actually passed the sustained
  // station trigger. A non-triggered transient may rise through 0-5, but never 6/7.
  function guardStationMarker(root) {
    const nodes = [];
    if (root?.nodeType === 1 && root.matches?.('.station-marker')) nodes.push(root);
    root?.querySelectorAll?.('.station-marker').forEach(node => nodes.push(node));
    for (const node of nodes) {
      if (node.classList.contains('triggered')) continue;
      let level = null;
      for (const cls of node.classList) {
        const match = /^activity-([0-7])$/.exec(cls);
        if (match) {
          level = Number(match[1]);
          break;
        }
      }
      if (level == null || level <= 5) continue;
      node.classList.remove(`activity-${level}`);
      node.classList.add('activity-5');
      node.dataset.rawActivityLevel = String(level);
      const label = node.querySelector('span');
      if (label) label.textContent = '5';
    }
  }

  if (document.body && 'MutationObserver' in window) {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => guardStationMarker(node));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    queueMicrotask(() => guardStationMarker(document.body));
  }

  const queryBase = normalize(queryApi);
  if (queryBase) localStorage.setItem('sdp-api-base', queryBase);

  const API_BASE = normalize(window.SDP_API_BASE)
    || queryBase
    || normalize(storedApi)
    || (isGithubPages ? defaultRender : '');

  window.SDP_API_BASE = API_BASE;
  window.SDP_BACKEND_MODE = API_BASE ? 'remote' : 'same-origin';

  if (isGithubPages && 'serviceWorker' in navigator) {
    const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (scriptURL, options) => {
      const routed = scriptURL === '/static/sw.js' ? './web/sw.js' : scriptURL;
      return nativeRegister(routed, options);
    };
  }

  if (!API_BASE) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(`${API_BASE}${input}`, init);
    }
    return nativeFetch(input, init);
  };

  const NativeWebSocket = window.WebSocket;
  function RoutedWebSocket(url, protocols) {
    let target = String(url);
    try {
      const parsed = new URL(target, location.href);
      const sameFrontendHost = parsed.host === location.host;
      if (sameFrontendHost && parsed.pathname === '/ws') {
        const wsBase = API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        target = `${wsBase}/ws`;
      }
    } catch {
      // Keep the original URL if parsing fails.
    }

    const socket = protocols === undefined
      ? new NativeWebSocket(target)
      : new NativeWebSocket(target, protocols);

    let heartbeat = null;
    socket.addEventListener('open', () => {
      heartbeat = setInterval(() => {
        if (socket.readyState === NativeWebSocket.OPEN) {
          try { socket.send('ping'); } catch { /* app.js handles reconnects */ }
        }
      }, 60_000);
    });
    socket.addEventListener('close', () => {
      if (heartbeat) clearInterval(heartbeat);
    });
    return socket;
  }

  RoutedWebSocket.prototype = NativeWebSocket.prototype;
  RoutedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  RoutedWebSocket.OPEN = NativeWebSocket.OPEN;
  RoutedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  RoutedWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = RoutedWebSocket;
})();
