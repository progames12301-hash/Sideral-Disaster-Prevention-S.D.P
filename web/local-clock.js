(() => {
  const clock = document.getElementById('utcClock');
  if (!clock) return;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const zoneLabel = timeZone.includes('/')
    ? timeZone.split('/').pop().replaceAll('_', ' ')
    : timeZone;

  const render = () => {
    const now = new Date();
    const time = now.toLocaleTimeString('pt-BR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    clock.textContent = `${time} · ${zoneLabel}`;
    clock.title = `Hora local do dispositivo · ${timeZone}`;
  };

  render();
  setInterval(render, 250);
})();
