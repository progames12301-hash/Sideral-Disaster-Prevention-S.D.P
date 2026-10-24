import {fetchJson,parseDate,proxyBase} from '../config.js';

export class RegionalProvider{
  constructor(){this.id='regional';this.name='Radares regionais';this.base=proxyBase();this.frames=[];this.radars=[];this.product='reflectivity';this.officialUrl='https://sifap.defesacivil.sc.gov.br/'}
  async load(product='reflectivity'){
    this.product=product==='ppi_v'?'ppi_v':'reflectivity';
    if(!this.base)throw new Error('Os radares regionais não estão disponíveis no momento.');
    const payload=await fetchJson(`${this.base}/api/regional/radar?product=${encodeURIComponent(this.product)}`,{},35000);
    this.radars=(payload.radars||[]).filter(radar=>Array.isArray(radar.frames)&&radar.frames.length);
    if(!this.radars.length)throw new Error('Nenhuma rede regional publicou imagem acessível agora.');
    const moments=new Map();
    this.radars.flatMap(radar=>radar.frames).forEach(frame=>{const date=parseDate(frame.date);if(date)moments.set(date.getTime(),date)});
    this.frames=[...moments.values()].sort((a,b)=>a-b).slice(-24).map((date,index)=>({index,date}));
    if(!this.frames.length)this.frames=[{index:0,date:new Date()}];
    const bounds=this.radars.reduce((box,radar)=>{const b=radar.bounds;if(!Array.isArray(b)||b.length!==4)return box;return box?[Math.min(box[0],b[0]),Math.min(box[1],b[1]),Math.max(box[2],b[2]),Math.max(box[3],b[3])]:b.slice()},null);
    return {frames:this.frames,radars:this.radars,focusBounds:bounds,note:`${this.radars.length} radares regionais com publicação recente.`};
  }
  nearestFrame(radar,target,allowStale=false){
    let best=null,difference=Infinity;
    for(const frame of radar.frames){const date=parseDate(frame.date),delta=date?Math.abs(date-target):Infinity;if(delta<difference){difference=delta;best=frame}}
    return best&&(allowStale||radar.frames.length===1||difference<=45*60*1000)?best:null;
  }
  async imageLayers(frameIndex,selected='all'){
    const target=this.frames[frameIndex]?.date?.getTime()||Date.now(),layers=[];
    for(const radar of this.radars){
      if(selected!=='all'&&radar.id!==selected)continue;
      // Redes estaduais nem sempre publicam no mesmo minuto da linha do tempo
      // (especialmente RS). Use o quadro mais próximo mesmo quando atrasado,
      // para que a camada não desapareça no modo "Todos".
      const frame=this.nearestFrame(radar,target,true);if(!frame)continue;
      const [west,south,east,north]=radar.bounds;
      const params=radar.kind==='sc'?`provider=sc&radar=${encodeURIComponent(radar.id)}&file=${encodeURIComponent(frame.key)}&product=${encodeURIComponent(this.product)}`:radar.kind==='rs'?`provider=rs&frame=${encodeURIComponent(frame.key)}&clean=1`:'provider=funceme';
      layers.push({kind:'image',id:`regional-${radar.id}`,cacheKey:`regional:${radar.id}:${frame.key}:${this.product}${radar.kind==='rs'?':clean1':''}`,url:`${this.base}/api/regional/radar/image?${params}`,coordinates:[[west,north],[east,north],[east,south],[west,south]],radar,attribution:`Radar © ${radar.provider}`,preserveColors:true});
    }
    return layers;
  }
}
