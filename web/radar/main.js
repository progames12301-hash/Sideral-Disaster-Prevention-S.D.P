import {RadarManager} from './RadarManager.js?v=20260914-v5-clean25';

const app=new RadarManager();
app.init().catch(error=>{
  console.error('Falha fatal no radar:',error);
  document.getElementById('loadingScreen')?.classList.add('hidden');
  document.getElementById('statusTitle').textContent='Falha ao iniciar o mapa';
  document.getElementById('statusDetail').textContent=error.message;
});
window.clearTimeout(window.__sideralRadarLoadingTimer);
document.getElementById('loadingScreen')?.classList.add('hidden');
window.addEventListener('beforeunload',()=>app.destroy());
