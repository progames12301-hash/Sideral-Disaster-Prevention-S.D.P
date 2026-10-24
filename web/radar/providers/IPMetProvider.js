import {CONFIG,fetchJson,proxyBase,parseDate} from '../config.js';
export class IPMetProvider{
  constructor(){this.id='ipmet';this.name='IPMet / UNESP';this.officialUrl=CONFIG.ipmetOfficial;this.base=proxyBase()}
  async load(){
    if(!this.base)throw new Error('As imagens do IPMet não estão disponíveis no momento.');
    const meta=await fetchJson(`${this.base}/api/ipmet/meta`,{},18000);
    if(!meta.available)throw new Error(meta.error||'IPMet sem imagem disponível');
    const date=parseDate(meta.scanTime||meta.updatedAt);
    return {frames:[{date,meta}],radars:CONFIG.ipmetRadars};
  }
  frameLayer(frame,quality='balanced'){
    const size=['ultra','extreme','supreme4k'].includes(quality)?1024:quality==='high'?512:256;
    const params=new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:'merged',styles:'',format:'image/png',transparent:'true',srs:'EPSG:900913',width:String(size),height:String(size)});
    return {kind:'tiles',id:'ipmet-live',tiles:[`${this.base}/api/ipmet/wms?${params}&bbox={bbox-epsg-3857}`],tileSize:size,bounds:CONFIG.ipmetBounds,maxzoom:12,attribution:'Radar © IPMet/UNESP'};
  }
}
