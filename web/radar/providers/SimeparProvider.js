import {fetchJson,parseDate,proxyBase} from '../config.js';

const BOUNDS=[-57.0,-29.2,-45.5,-20.5];
const RADAR={id:'simepar-cascavel',code:'simepar-cascavel',provider:'SIMEPAR',name:'Radar SIMEPAR — Cascavel/PR',latitude:-24.9558,longitude:-53.4567,rangeKm:240,surveillanceKm:480};

export class SimeparProvider{
  constructor(){this.id='simepar';this.name='SIMEPAR';this.base=proxyBase();this.officialUrl='https://www.simepar.br/simepar/radar_msc';this.frames=[];this.overlayCache=new Map()}
  async load(){
    if(!this.base)throw new Error('As imagens do SIMEPAR não estão disponíveis no momento.');
    const data=await fetchJson(`${this.base}/api/simepar/meta`,{},30000);
    const frames=(data.frames||[]).map(item=>({date:parseDate(item.date),frame:item.frame,url:`${this.base}/api/simepar/image?frame=${item.frame}`}));
    if(!frames.length)throw new Error('SIMEPAR sem imagem oficial acessível');
    this.frames=frames;
    return {frames,radars:[RADAR],focusBounds:BOUNDS,note:data.note||'Mosaico oficial do SIMEPAR.'};
  }
  isRadarPixel(red,green,blue,x,y,width,height){
    if(x>width*.62&&y>height*.87)return false;
    const maximum=Math.max(red,green,blue),minimum=Math.min(red,green,blue),spread=maximum-minimum;
    if(maximum<105||spread<58)return false;
    const weakGreen=green>125&&green>red*1.38&&green>blue*1.32;
    const yellowOrange=red>135&&green>88&&blue<Math.min(red,green)*.58;
    const redEcho=red>150&&red>green*1.55&&red>blue*1.2;
    const magentaEcho=red>125&&blue>90&&green<Math.min(red,blue)*.68;
    return weakGreen||yellowOrange||redEcho||magentaEcho;
  }
  async transparentOverlay(frame){
    if(this.overlayCache.has(frame.url))return this.overlayCache.get(frame.url);
    const response=await fetch(frame.url,{cache:'no-store',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error(`SIMEPAR respondeu HTTP ${response.status}`);
    const bitmap=await createImageBitmap(await response.blob());
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
    const image=context.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
    for(let offset=0,pixel=0;offset<pixels.length;offset+=4,pixel++){
      const x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);
      if(this.isRadarPixel(pixels[offset],pixels[offset+1],pixels[offset+2],x,y,canvas.width,canvas.height)){
        const spread=Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])-Math.min(pixels[offset],pixels[offset+1],pixels[offset+2]);
        pixels[offset+3]=Math.min(255,Math.max(145,spread*2));
      }else pixels[offset+3]=0;
    }
    context.putImageData(image,0,0);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Falha ao preparar a camada SIMEPAR')),'image/png'));
    const overlay=URL.createObjectURL(blob);this.overlayCache.set(frame.url,overlay);
    while(this.overlayCache.size>12){const [key,url]=this.overlayCache.entries().next().value;this.overlayCache.delete(key);URL.revokeObjectURL(url)}
    return overlay;
  }
  async imageLayers(frameIndex){
    const frame=this.frames[frameIndex];if(!frame)return [];
    const [west,south,east,north]=BOUNDS,url=await this.transparentOverlay(frame);
    return [{kind:'image',id:'simepar-live',url,coordinates:[[west,north],[east,north],[east,south],[west,south]],radar:RADAR,attribution:'Radar © SIMEPAR'}];
  }
}
