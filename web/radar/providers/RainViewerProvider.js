import {CONFIG,fetchJson,proxyBase} from '../config.js?v=20260826-smooth2';

export class RainViewerProvider {
  constructor() {
    this.id = 'rainviewer';
    this.name = 'RainViewer';
    this.officialUrl = 'https://www.rainviewer.com/';
    this.base = proxyBase();
    this.host = 'https://tilecache.rainviewer.com';
  }

  async load() {
    const urls = [CONFIG.rainviewerApi];
    // Usar proxy se configurado (servidor local)
    if (this.base) urls.push(`${this.base}/api/rainviewer/meta`);
    let data,lastError;
    for (const url of urls) {
      try { data = await fetchJson(url,{},16000); break; }
      catch (error) { lastError = error; }
    }
    if (!data) throw lastError || new Error('RainViewer não respondeu');
    this.host = data.host || this.host;
    const frames = (data.radar?.past || [])
      .slice(-13)
      .map(frame => ({...frame, date: new Date(frame.time * 1000)}));
    if (!frames.length) throw new Error('Nenhum quadro de precipitação disponível');
    await this.verifyTile(frames.at(-1));
    return {frames, radars: [], note: 'Mosaico de precipitação fornecido pela RainViewer.'};
  }

  async verifyTile(frame) {
    const suffix = `${frame.path}/512/3/2/4/2/0_1.png`;
    const candidates = [{proxy:false,url:`${this.host}${suffix}`}];
    if (this.base) candidates.push({proxy:true,url:`${this.base}/api/rainviewer/tile${suffix}`});
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate.url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
        if(response.ok&&/^image\/png/i.test(response.headers.get('content-type')||'')){
          this.useProxy=candidate.proxy;return;
        }
      } catch {}
    }
    throw new Error('RainViewer respondeu sem uma imagem de radar válida para o Brasil');
  }

  frameLayer(frame, quality = 'balanced') {
    // Pixels sem suavização preservam a resolução real do mosaico, inclusive no zoom.
    const tileSize = 512;
    const smooth = ['ultra','extreme','supreme4k'].includes(quality) ? 0 : 1;
    const suffix = `${frame.path}/${tileSize}/{z}/{x}/{y}/2/${smooth}_1.png`;
    const tileUrl = this.base && this.useProxy!==false
      ? `${this.base}/api/rainviewer/tile${suffix}`
      : `${this.host}${suffix}`;
    return {
      kind: 'tiles',
      id: 'rainviewer',
      tiles: [tileUrl],
      tileSize,
      maxzoom: 7,
      attribution: 'Precipitação © RainViewer'
    };
  }
}
