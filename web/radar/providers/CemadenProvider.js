import {fetchJson,parseDate,proxyBase} from '../config.js';

export class CemadenProvider{
  constructor(){this.id='cemaden';this.name='CEMADEN / MCTI';this.base=proxyBase();this.frames=[];this.radars=[];this.officialUrl='https://mapainterativo.cemaden.gov.br/'}
  async load(product='cappi3'){
    const payload=await fetchJson(`${this.base}/api/cemaden/radar?product=${encodeURIComponent(product)}`,{},30000);
    if(!payload.status||!Array.isArray(payload.radars)||!payload.radars.length)throw new Error(payload.error||'O CEMADEN não publicou imagens recentes.');
    this.radars=payload.radars.map(radar=>({...radar,latitude:Number(radar.latitude),longitude:Number(radar.longitude),rangeKm:Number(radar.rangeKm)||250}));
    this.frames=(payload.frames||[]).map(frame=>({index:Number(frame.index),date:parseDate(frame.date)})).filter(frame=>frame.date);
    if(!this.frames.length)throw new Error('O catálogo do CEMADEN não contém quadros válidos.');
    const bounds=this.radars.map(radar=>radar.bounds).filter(item=>Array.isArray(item)&&item.length===4);
    const focusBounds=bounds.length?[Math.min(...bounds.map(item=>Number(item[0]))),Math.min(...bounds.map(item=>Number(item[1]))),Math.max(...bounds.map(item=>Number(item[2]))),Math.max(...bounds.map(item=>Number(item[3])))]:null;
    return {frames:this.frames,radars:this.radars,focusBounds,note:`${this.radars.length} radares recentes do CEMADEN · CAPPI 3 km.`,unavailableRadars:Number(payload.unavailableRadars)||0};
  }
  async imageLayers(frameIndex,selected='all',quality='extreme'){
    const frame=this.frames[frameIndex];if(!frame)return [];
    const size=quality==='supreme4k'?2048:quality==='extreme'?1536:quality==='ultra'?1024:quality==='high'?768:512;
    return this.radars.filter(radar=>selected==='all'||radar.id===selected).map(radar=>{
      const [west,south,east,north]=radar.bounds;
      const url=`${this.base}/api/cemaden/radar/imagem?radar=${encodeURIComponent(radar.id)}&frame=${frame.index}&size=${size}`;
      return {kind:'image',id:`cemaden-${radar.id}-${frame.index}`,cacheKey:`cemaden:${radar.id}:${frame.index}:${radar.scanTime}:${size}`,url,coordinates:[[west,north],[east,north],[east,south],[west,south]],radar,attribution:'Radar © CEMADEN/MCTI',preserveColors:true,nativePixels:true};
    });
  }
}
