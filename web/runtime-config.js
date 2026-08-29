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
