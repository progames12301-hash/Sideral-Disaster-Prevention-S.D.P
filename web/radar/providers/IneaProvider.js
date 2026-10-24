import {fetchJson,proxyBase} from '../config.js';

const RADARS=[
  {id:'gua',code:'gua',provider:'INEA',name:'INEA — Guaratiba/RJ',latitude:-22.99328041,longitude:-43.58795929,rangeKm:250,bounds:[-46.027562,-25.245533,-41.148357,-20.741028]},
  {id:'mac',code:'mac',provider:'INEA',name:'INEA — Macaé/RJ',latitude:-22.40583229,longitude:-41.86046219,rangeKm:250,bounds:[-44.289624,-24.658085,-39.431300,-20.153580]}
];

function localDate(label){
  const match=String(label||'').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  return match?new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00`):null;
}

export class IneaProvider{
  constructor(){this.id='inea';this.name='INEA / Alerta de Cheias RJ';this.base=proxyBase();this.frames=[];this.officialUrl='https://radartool.inea.rj.gov.br/radar-tool/'}
  async load(product='zh'){
    if(!this.base)throw new Error('As imagens do INEA não estão disponíveis no momento.');
    const results=await Promise.allSettled(RADARS.map(async radar=>({radar,data:await fetchJson(`${this.base}/api/inea/frames?radar=${radar.id}&product=${product}`,{},26000)})));
    const available=results.filter(result=>result.status==='fulfilled'&&result.value.data.images?.length).map(result=>result.value);
    if(!available.length)throw new Error('INEA não publicou imagens acessíveis de Guaratiba ou Macaé');
    const count=Math.max(...available.map(item=>item.data.images.length));
    this.frames=Array.from({length:count},(_,index)=>{
      const items=available.flatMap(({radar,data})=>{
        const offset=count-data.images.length,sourceIndex=index-offset;
        if(sourceIndex<0||!data.images[sourceIndex])return [];
        return [{radar:radar.id,path:`${this.base}/api/inea/image?radar=${radar.id}&product=${product}&file=${encodeURIComponent(data.images[sourceIndex])}`,date:localDate(data.labels?.[sourceIndex]),bounds:radar.bounds}];
      });
      const dates=items.map(item=>item.date).filter(Boolean);
      return {index,items,date:dates.length?new Date(Math.max(...dates.map(date=>date.getTime()))):null};
    });
    const radars=available.map(item=>item.radar);
    return {frames:this.frames,radars,focusBounds:[-46.03,-25.25,-39.43,-20.15],note:`${radars.length} ${radars.length===1?'radar do INEA disponível':'radares do INEA disponíveis'}.`};
  }
  async imageLayers(frameIndex,selected='all'){
    const frame=this.frames[frameIndex];if(!frame)return [];
    return frame.items.filter(item=>selected==='all'||item.radar===selected).map(item=>{
      const radar=RADARS.find(entry=>entry.id===item.radar);const [west,south,east,north]=item.bounds;
      return {kind:'image',id:`inea-${item.radar}`,url:`${item.path}&alpha=2`,coordinates:[[west,north],[east,north],[east,south],[west,south]],attribution:item.product==='vel'?'Radar Doppler © INEA/RJ':'Radar © INEA/RJ',radar,preserveColors:true};
    });
  }
}
