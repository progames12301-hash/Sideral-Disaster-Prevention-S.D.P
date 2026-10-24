import {PolarLayer,palette} from './PolarLayer.js?v=20260913-cptec-fix1';
import {RADAR_STYLES,radarPalette} from '../RadarStyles.js?v=20260914-v5-clean25';
import {createV5PolarLayer} from '../map/V5PolarLayer.js?v=20260914-v5-clean25';
import {createSuperResPolarLayer} from '../map/SuperResPolarLayer.js?v=20260930-superres1';
import {createV5VolumeLayer} from '../map/V5VolumeLayer.js?v=20260918-v5-volume1';
import {cptecReflectivityCode,SUPER_RES_DBZ_PALETTE} from '../map/RadarProfiles.js?v=20260914-v5-clean25';

const $=id=>document.getElementById(id);
const DOPPLER_PALETTES=new Set(['doppler_cptec','wx_bv','doppler_sr','wx_cc','wx_doppler']);
const gradientColors=name=>radarPalette(name)?.colors||[...String(RADAR_STYLES[name]?.gradient||'').matchAll(/#[0-9a-f]{6}\b/gi)].map(match=>match[0]);
const hexRgb=hex=>{const n=parseInt(hex.slice(1),16);return[n>>16,(n>>8)&255,n&255]};
const mercatorY=latitude=>{const sin=Math.sin(Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180);return .5-Math.log((1+sin)/(1-sin))/(4*Math.PI)};

function scopeOrigin(metadata){
  const coordinates=metadata.coordinates;if(!Array.isArray(coordinates)||coordinates.length<4)return[.5,.5];
  const west=Number(coordinates[0][0]),east=Number(coordinates[1][0]),north=Number(coordinates[0][1]),south=Number(coordinates[2][1]);
  const longitude=Number(metadata.longitude),latitude=Number(metadata.latitude),northY=mercatorY(north),southY=mercatorY(south);
  if(![west,east,north,south,longitude,latitude].every(Number.isFinite)||west===east||northY===southY)return[.5,.5];
  return[(longitude-west)/(east-west),(mercatorY(latitude)-northY)/(southY-northY)];
}

function scopeUrl(blobUrl,metadata,profile,paletteName){
  const [x,y]=scopeOrigin(metadata),palettePart=paletteName&&radarPalette(paletteName)?`&sideral_palette=${encodeURIComponent(paletteName)}`:'';
  return `radarscope://blob/${encodeURIComponent(blobUrl)}?sideral_scope=image,${x},${y},${profile}${palettePart}`;
}

function echoRank(red,green,blue){
  const max=Math.max(red,green,blue),min=Math.min(red,green,blue),spread=max-min;
  if(max<10)return -1;if(spread<16)return max>225?13:Math.max(0,Math.min(12,Math.round(max/20)));
  if(red>190&&blue>130&&green<150)return 12;if(red>green*1.35)return red>225&&green>125?8:red>205?10:9;
  if(red>170&&green>150&&blue<120)return 7;if(green>red*1.18&&green>blue*1.08)return green>180?4:5;if(blue>green*1.1)return blue>185?1:2;return 6;
}

function v5Palette(name){
  const colors=gradientColors(name);
  if(name==='wx_scope5'||!colors.length)return SUPER_RES_DBZ_PALETTE.map(color=>color.slice());
  return Array.from({length:14},(_,index)=>hexRgb(colors[Math.round(index*(colors.length-1)/13)]));
}

async function processRaster(buffer,product,paletteName){
  if(typeof createImageBitmap!=='function')return buffer;
  const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/png'}));
  const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(bitmap.width,bitmap.height):Object.assign(document.createElement('canvas'),{width:bitmap.width,height:bitmap.height});
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true});if(!context){bitmap.close?.();return buffer}
  context.imageSmoothingEnabled=false;context.clearRect(0,0,bitmap.width,bitmap.height);context.drawImage(bitmap,0,0);bitmap.close?.();
  const image=context.getImageData(0,0,canvas.width,canvas.height),data=image.data,colors=gradientColors(paletteName).map(hexRgb);
  for(let index=0;index<data.length;index+=4){
    if(data[index+3]<12)continue;const red=data[index],green=data[index+1],blue=data[index+2];if(red<10&&green<10&&blue<10){data[index+3]=0;continue}if(!colors.length||paletteName==='normal')continue;
    let rank;if(product==='velocity'){const spread=Math.max(red,green,blue)-Math.min(red,green,blue),middle=(colors.length-1)/2;rank=spread<18?Math.round(middle):green>red?Math.round(middle-middle*Math.min(1,(green-red+spread)/360)):Math.round(middle+middle*Math.min(1,(red-green+spread)/360))}else rank=Math.round(echoRank(red,green,blue)*(colors.length-1)/13);
    if(rank<0)continue;const color=colors[Math.max(0,Math.min(colors.length-1,rank))];data[index]=color[0];data[index+1]=color[1];data[index+2]=color[2];
  }
  context.putImageData(image,0,0);const blob=canvas.convertToBlob?await canvas.convertToBlob({type:'image/png'}):await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Falha ao aplicar a paleta.')),'image/png'));return blob.arrayBuffer();
}

export class ScopeV3{
  constructor(app){
    this.app=app;this.active=false;this.sequence=0;this.frames=[];this.cache=new Map();this.processedCache=new Map();this.volumeCache=new Map();this.radarCatalog=[];this.savedView=null;
    this.base=String(window.SIDERAL_RADAR_V3_BASE||window.SIDERAL_RADAR_PROXY_BASE||localStorage.getItem('sideralRadarProxyBase')||(['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:8766':location.origin)).replace(/\/$/,'');
    const mode=$('renderMode'),source=$('sourceSelect');if(!mode.querySelector('option[value="brasil_scope_v3"]'))mode.add(new Option('Brasil Scope V3','brasil_scope_v3'));if(!mode.querySelector('option[value="brasil_scope_v4"]'))mode.add(new Option('Brasil Scope V4 - gates polares','brasil_scope_v4'),mode.querySelector('option[value="sideral_hub"]'));if(source&&!source.querySelector('option[value="cptec"]'))source.add(new Option('Radares CPTEC / INPE','cptec'),source.querySelector('option[value="cemaden"]'));
    this.onChange=async event=>{if(event.target!==mode)return;if(['brasil_scope_v3','brasil_scope_v4','brasil_scope_v5','super_res'].includes(mode.value)&&(source?.value==='cptec'||this.active)){event.stopImmediatePropagation();await this.enter(mode.value==='brasil_scope_v5'?'scope5':mode.value==='super_res'?'superres':mode.value==='brasil_scope_v4'?'scope4':null)}else if(this.active){event.stopImmediatePropagation();const next=mode.value;this.leave();this.app.setRenderMode(next)}};
    this.onSourceChange=async event=>{if(event.target!==source)return;if(source.value==='cptec'){event.stopImmediatePropagation();await this.enter(mode?.value==='brasil_scope_v5'?'scope5':mode?.value==='super_res'?'superres':mode?.value==='brasil_scope_v4'?'scope4':null);return}if(this.active){event.stopImmediatePropagation();const nextSource=source.value,savedMode=this.saved?.mode||'standard';this.leave({switchSource:false});this.app.setRenderMode(savedMode);source.value=nextSource;await this.app.switchSource(nextSource)}};
    mode.addEventListener('change',this.onChange,true);source?.addEventListener('change',this.onSourceChange,true);this.styleReload=()=>{if(this.active&&this.current)void this.draw(this.current)};app.map.map.on('style.load',this.styleReload);
  }
  status(title,error=false){this.app.ui.status({title,origin:'Brasil Scope V3 · CPTEC/INPE',date:this.current?.metadata.timestamp?new Date(this.current.metadata.timestamp):undefined,error})}
  async json(path,signal){const timeout=AbortSignal.timeout(30000),response=await fetch(this.base+path,{signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store'});if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Brasil Scope V3 temporariamente indisponível.');const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível obter esta varredura.');return data}
  async enter(requestedModel=null){
    if(this.active){if(requestedModel&&$('v3RenderModel')){$('v3RenderModel').value=requestedModel;this.app.renderMode=requestedModel==='scope5'?'brasil_scope_v5':requestedModel==='superres'?'super_res':'brasil_scope_v4';$('renderMode').value=this.app.renderMode;try{localStorage.setItem('sideralRadarV3RenderModel',requestedModel);localStorage.setItem('sideralRadarRenderMode',this.app.renderMode)}catch{}this.processedCache.clear();if(this.current)await this.draw(this.current)}return}this.active=true;this.saved={source:this.app.source,mode:this.app.renderMode};this.app.renderMode=requestedModel==='scope5'?'brasil_scope_v5':requestedModel==='superres'?'super_res':requestedModel==='scope4'?'brasil_scope_v4':'brasil_scope_v3';$('renderMode').value=this.app.renderMode;if($('sourceSelect'))$('sourceSelect').value='cptec';try{localStorage.setItem('sideralRadarRenderMode',this.app.renderMode)}catch{}this.app.animation.pause();this.app.renderToken++;this.app.preloadToken++;clearTimeout(this.app.preloadTimer);
    this.originals={};for(const name of ['render','switchSource','scheduleFramePreload','loadLightning']){this.originals[name]=this.app[name];this.app[name]=()=>Promise.resolve(false)}
    this.app.map.clearRadar();this.app.map.clearStormTrack();if(this.app.map.map.isStyleLoaded()){this.app.map.setCoverage([],false);this.app.map.setLightning([],false)}this.legendDisplay=document.querySelector('.dbz-legend').style.display;document.querySelector('.dbz-legend').style.display='block';
    this.mapOriginals={};for(const name of ['setCoverage','setLightning']){this.mapOriginals[name]=this.app.map[name];this.app.map[name]=()=>{}}
    this.hidden=[];for(const id of ['radarField','productField','productTiles','productProfileTitle','productProfileDetail']){const target=$(id);if(target){this.hidden.push([target,target.hidden]);target.hidden=true}}
    this.panel=document.createElement('div');this.panel.className='v3-layer-controls';this.panel.innerHTML='<label>Radar<select id="v3Radar"></select></label><label>Produto<select id="v3Product"><option value="reflectivity">Refletividade</option><option value="velocity">Velocidade Doppler</option></select></label><label>Combinação visual<select id="v3RenderModel"><option value="native">Brasil Scope V3</option><option value="scope4">Brasil Scope V4 - gates polares</option><option value="scope5">Brasil Scope V5 - 1 milhão de gates</option><option value="superres">Super Res - malha universal 0,5°/250 m</option><option value="radarscope3">Brasil Scope V3 + Radar Scope V3</option><option value="radarscope2hd">Brasil Scope V3 + Radar Scope V2 HD</option></select></label>';const sourceLabel=$('sourceSelect')?.closest('label');(sourceLabel||document.querySelector('.radar-panel .panel-tabs')).after(this.panel);
    $('v3Radar').onchange=()=>{try{localStorage.setItem('sideralRadarV3Radar',$('v3Radar').value)}catch{}this.selectRadar()};$('v3Product').onchange=()=>{try{localStorage.setItem('sideralRadarV3Product',$('v3Product').value)}catch{}this.syncPalettes();this.load()};$('v3RenderModel').onchange=async()=>{const model=$('v3RenderModel').value;this.app.renderMode=model==='scope5'?'brasil_scope_v5':model==='superres'?'super_res':model==='scope4'?'brasil_scope_v4':'brasil_scope_v3';$('renderMode').value=this.app.renderMode;try{localStorage.setItem('sideralRadarV3RenderModel',model);localStorage.setItem('sideralRadarRenderMode',this.app.renderMode)}catch{}this.processedCache.clear();if(this.current){await this.draw(this.current);this.status(`${this.current.metadata.product==='velocity'?'Velocidade Doppler':'Refletividade'} · ${$('v3RenderModel').selectedOptions[0].textContent}`)}};
    this.handlers=[];const intercept=(id,type,fn)=>{const handler=e=>{if(this.active){e.stopImmediatePropagation();fn(e)}};$(id).addEventListener(type,handler,true);this.handlers.push([id,type,handler])};
    intercept('prevFrame','click',()=>this.show(Math.max(0,this.index-1)));intercept('nextFrame','click',()=>this.show(Math.min(this.frames.length-1,this.index+1)));intercept('frameSlider','input',e=>{clearTimeout(this.scrub);this.scrub=setTimeout(()=>this.show(Number(e.target.value)),50)});intercept('frameSlider','change',e=>{clearTimeout(this.scrub);this.show(Number(e.target.value))});
    intercept('playPause','click',()=>{if(this.play){clearInterval(this.play);this.play=null;this.app.ui.playing(false)}else{this.app.ui.playing(true);this.play=setInterval(()=>{if(!this.busy&&this.frames.length)this.show((this.index+1)%this.frames.length)},900)}});
    intercept('opacityRange','input',e=>{const opacity=Number(e.target.value)/100;for(const layer of this.layers||[])layer.opacity=opacity;for(const id of this.rasterLayerIds||[])if(this.app.map.map.getLayer(id))this.app.map.map.setPaintProperty(id,'raster-opacity',opacity);this.app.map.map.triggerRepaint();$('opacityValue').value=e.target.value+'%'});
    intercept('paletteSelect','change',()=>{const value=$('paletteSelect').value;this.app.paletteChoice=value;this.app.style=value;try{localStorage.setItem('sideralRadarPaletteChoice',value);localStorage.setItem('sideralRadarStyle',value)}catch{}this.processedCache.clear();if(this.current)void this.draw(this.current);this.legend(this.current?.metadata.product)});intercept('downloadRadar','click',()=>this.download());this.status('Carregando Brasil Scope V3…');
    try{const data=await this.json('/api/radar/v3/radars');if(!this.active)return;this.radarCatalog=data.radars||[];if(requestedModel==='scope5'||$('v3RenderModel')?.value==='scope5'){const firstVolume=this.radarCatalog.find(radar=>radar.volume&&Array.isArray(radar.products)&&radar.products.includes('reflectivity'));if(firstVolume&&!this.radarCatalog.some(radar=>radar.id===$('v3Radar').value&&radar.volume))$('v3Radar').value=firstVolume.id}for(const radar of data.radars)$('v3Radar').add(new Option(radar.state?`${radar.name} · ${radar.state}`:radar.name,radar.id));if(!data.radars.length)throw new Error('Nenhuma varredura disponível.');try{const requested=new URLSearchParams(location.search).get('radar'),stored=localStorage.getItem('sideralRadarV3Radar'),radar=data.radars.some(item=>item.id===requested)?requested:stored,product=localStorage.getItem('sideralRadarV3Product'),storedModel=localStorage.getItem('sideralRadarV3RenderModel'),model=requestedModel||storedModel;if(radar&&data.radars.some(item=>item.id===radar))$('v3Radar').value=radar;if(['reflectivity','velocity'].includes(product))$('v3Product').value=product;if(['native','scope4','scope5','superres','radarscope3','radarscope2hd'].includes(model))$('v3RenderModel').value=model;if(['scope4','scope5','superres'].includes($('v3RenderModel').value)){this.app.renderMode=$('v3RenderModel').value==='scope5'?'brasil_scope_v5':$('v3RenderModel').value==='superres'?'super_res':'brasil_scope_v4';$('renderMode').value=this.app.renderMode}}catch{}await this.selectRadar()}catch(error){if(this.active)this.status(error.message,true)}
    this.refresh=setInterval(()=>{if(!this.busy&&!this.play&&$('v3Radar')?.value)this.load(true)},60000);
  }
  syncPalettes(){
    const velocity=$('v3Product')?.value==='velocity',select=$('paletteSelect');this.app.setDopplerPaletteAvailability(velocity);if(!select)return;
    if(velocity&&!DOPPLER_PALETTES.has(select.value))select.value='doppler_cptec';if(!velocity&&DOPPLER_PALETTES.has(select.value))select.value='wx_radarscope_v2_hd';this.app.paletteChoice=select.value;this.app.style=select.value;this.processedCache.clear();this.app.updateLegend();
  }
  async products(radar){const select=$('v3Product'),data=await this.json('/api/radar/v3/products?radar='+encodeURIComponent(radar));for(const option of select.options)option.disabled=!data.products.includes(option.value);if(data.products.length&&!data.products.includes(select.value))select.value=data.products[0];this.syncPalettes();return data.products}
  async selectRadar(){
    if(!this.availabilityChecked){
      this.availabilityChecked=true;const select=$('v3Radar'),ordered=[select.value,...Array.from(select.options,option=>option.value).filter(value=>value!==select.value)];
      for(const candidate of ordered){try{const availability=await this.json('/api/radar/v3/products?radar='+encodeURIComponent(candidate));if(availability.products?.length){select.value=candidate;break}}catch{}}
    }
    if($('v3RenderModel')?.value==='scope5'){
      const selected=this.radarCatalog.find(item=>item.id===$('v3Radar').value);
      const volume=this.radarCatalog.find(item=>item.volume&&Array.isArray(item.products)&&item.products.includes($('v3Product').value||'reflectivity'));
      if(!selected?.volume&&volume)$('v3Radar').value=volume.id;
    }
    const radar=$('v3Radar').value;this.abort?.abort();this.sequence++;this.busy=false;clearInterval(this.play);this.play=null;this.app.ui.playing(false);this.removeLayers();this.current=null;this.frames=[];this.app.ui.timeline([],0);this.status('Verificando produtos do radar…');
    try{const products=await this.products(radar);if(!this.active||$('v3Radar').value!==radar)return;if(!products.length)throw new Error('Nenhuma imagem recente disponível para este radar.');await this.load()}catch(error){if(this.active)this.status(error.message,true)}
  }
  async load(refresh=false){
    this.abort?.abort();this.abort=new AbortController();const token=++this.sequence;if(this.play){clearInterval(this.play);this.play=null;this.app.ui.playing(false)}if(!refresh){this.removeLayers();this.current=null;this.frames=[];this.app.ui.timeline([],0)}this.status('Buscando varreduras…');
    try{const result=await this.json(`/api/radar/v3/frames?radar=${encodeURIComponent($('v3Radar').value)}&product=${$('v3Product').value}`,this.abort.signal);if(!this.active||token!==this.sequence)return;this.frames=result.frames||[];if(!this.frames.length)throw new Error('Este radar não possui varreduras recentes para o produto selecionado.');this.app.ui.timeline(this.frames.map(m=>({date:new Date(m.timestamp)})),this.frames.length-1);await this.show(this.frames.length-1)}catch(error){if(error.name!=='AbortError'&&this.active&&token===this.sequence)this.status(error.message,true)}
  }
  async fetchFrame(metadata,token){let m=metadata;if(m.kind!=='raster'&&!m.azimuthStart)m=await this.json('/api/radar/v3/metadata?id='+m.frameId,AbortSignal.timeout(20000));if(!this.active||token!==this.sequence)return null;let buffer=this.cache.get(m.frameId);if(!buffer){const response=await fetch(this.base+m.dataUrl,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Quadro indisponível.');buffer=await response.arrayBuffer();this.cache.set(m.frameId,buffer);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value)}return{metadata:m,buffer}}
  async fetchVolume(metadata,token){
    const radar=metadata.radar,product=metadata.product,stamp=metadata.timestamp||'';
    const key=`${radar}:${product}:${stamp}`;if(this.volumeCache.has(key))return this.volumeCache.get(key);
    const query=`/api/radar/v3/volume?radar=${encodeURIComponent(radar)}&product=${encodeURIComponent(product)}${stamp?`&time=${encodeURIComponent(stamp)}`:''}`;
    const volume=await this.json(query,AbortSignal.timeout(45000));
    if(!this.active||token!==this.sequence)return null;this.volumeCache.set(key,volume);while(this.volumeCache.size>3)this.volumeCache.delete(this.volumeCache.keys().next().value);return volume;
  }
  async show(index){
    if(!this.active||!this.frames[index])return;const token=++this.sequence;this.busy=true;
    try{const frame=await this.fetchFrame(this.frames[index],token);if(!frame||!this.active||token!==this.sequence)return;this.frames[index]=frame.metadata;const changedRadar=this.current?.metadata.radar!==frame.metadata.radar;this.current=frame;this.index=index;await this.draw(frame);if(changedRadar)this.app.map.map.flyTo({center:[frame.metadata.longitude,frame.metadata.latitude],zoom:7});this.app.ui.frame(index,new Date(frame.metadata.timestamp));this.legend(frame.metadata.product);const model=$('v3RenderModel')?.selectedOptions[0]?.textContent||'Brasil Scope V3';this.status(`${frame.metadata.product==='velocity'?'Velocidade Doppler':'Refletividade'} · ${model}`)}catch(error){if(this.active&&token===this.sequence)this.status(error.message,true)}finally{if(token===this.sequence)this.busy=false}
  }
  removeLayers(){const map=this.app.map.map;for(const id of this.layerIds||[])if(map.getLayer(id))map.removeLayer(id);for(const id of this.sourceIds||[])if(map.getSource?.(id))map.removeSource(id);for(const url of this.imageUrls||[])URL.revokeObjectURL(url);for(const release of this.scopeReleases||[])release();this.layerIds=[];this.sourceIds=[];this.imageUrls=[];this.scopeReleases=[];this.rasterLayerIds=[];this.layers=[]}
  async draw(frame){
    if(($('v3RenderModel')?.value==='scope5'||$('v3RenderModel')?.value==='superres')&&frame.metadata.product==='reflectivity'){
      const select=$('paletteSelect');if(!select.querySelector('option[value="wx_scope5"]'))select.add(new Option('Brasil Scope V5 · PPI polar','wx_scope5'));
      if(!this.scope5PaletteInitialized){select.value='wx_scope5';this.app.paletteChoice='wx_scope5';this.app.style='wx_scope5';this.scope5PaletteInitialized=true}
    }
    if($('v3RenderModel')?.value==='scope4'&&frame.metadata.product==='reflectivity'){
      const select=$('paletteSelect');if(!select.querySelector('option[value="wx_scope4"]'))select.add(new Option('Brasil Scope V4','wx_scope4'));
      select.value='wx_scope4';this.app.paletteChoice='wx_scope4';this.app.style='wx_scope4';
    }
    const map=this.app.map.map;if(!map.isStyleLoaded())return;this.removeLayers();const before=map.getStyle().layers.find(layer=>layer.id.startsWith('boundaries-'))?.id,opacity=Number($('opacityRange').value)/100,id='brasil-scope-v3',paletteName=$('paletteSelect').value,model=$('v3RenderModel')?.value||'native';
    if(frame.metadata.kind==='raster'){
      if(model==='scope5'&&frame.metadata.product==='reflectivity'){
        const radarInfo=this.radarCatalog.find(item=>item.id===frame.metadata.radar);
        if(radarInfo?.volume){
          const volume=await this.fetchVolume(frame.metadata,this.sequence);if(!volume)throw new Error('Volume radar indisponível.');
          map.__v5Base=this.base;
          const layer=createV5VolumeLayer({id:'brasil-scope-v5-volume',volume,palette:v5Palette(paletteName),opacity});
          this.layers.push(layer);this.layerIds.push(layer.id);map.addLayer(layer,before);
          if(!await layer.readyPromise)throw new Error('Não foi possível montar a varredura 3D do Brasil Scope V5.');
          if(!this.savedView)this.savedView={pitch:map.getPitch(),bearing:map.getBearing()};
          map.easeTo({pitch:48,duration:350});return;
        }
        const blobUrl=URL.createObjectURL(new Blob([frame.buffer],{type:'image/png'}));this.imageUrls.push(blobUrl);
        const layer=createV5PolarLayer({id:'brasil-scope-v5-cptec',sourceLayer:{url:blobUrl,coordinates:frame.metadata.coordinates,radar:{id:frame.metadata.radar,longitude:Number(frame.metadata.longitude),latitude:Number(frame.metadata.latitude),rangeKm:Number(frame.metadata.rangeKm)},polar:frame.metadata.polar},palette:v5Palette(paletteName),classify:cptecReflectivityCode,dbzByCode:[5,10,15,20,25,30,35,40,45,50,55,60,65,70],opacity});
        this.layers.push(layer);this.layerIds.push(layer.id);map.addLayer(layer,before);if(!await layer.readyPromise)throw new Error('Não foi possível montar os gates polares do PPI.');return;
      }
      if(model==='superres'&&frame.metadata.product==='reflectivity'){
        // Modelo Super Res: mesma geometria geodésica do V5, porém travada na
        // malha real de super-resolução (0,5° × 250 m), sempre 2D e sempre
        // universal — não depende de volume 3D nem de metadados por radar.
        const blobUrl=URL.createObjectURL(new Blob([frame.buffer],{type:'image/png'}));this.imageUrls.push(blobUrl);
        const layer=createSuperResPolarLayer({id:'super-res-cptec',sourceLayer:{url:blobUrl,coordinates:frame.metadata.coordinates,radar:{id:frame.metadata.radar,longitude:Number(frame.metadata.longitude),latitude:Number(frame.metadata.latitude),rangeKm:Number(frame.metadata.rangeKm)},polar:frame.metadata.polar},palette:v5Palette(paletteName),classify:cptecReflectivityCode,dbzByCode:[5,10,15,20,25,30,35,40,45,50,55,60,65,70],opacity});
        this.layers.push(layer);this.layerIds.push(layer.id);map.addLayer(layer,before);if(!await layer.readyPromise)throw new Error('Não foi possível montar os gates polares do Super Res.');return;
      }
      const radial=frame.metadata.product==='reflectivity'&&model!=='native';let buffer=frame.buffer;
      if(!radial){const key=`${frame.metadata.frameId}:${paletteName}`;buffer=this.processedCache.get(key);if(!buffer){buffer=await processRaster(frame.buffer,frame.metadata.product,paletteName);this.processedCache.set(key,buffer);while(this.processedCache.size>8)this.processedCache.delete(this.processedCache.keys().next().value)}}
      const profile=model==='scope4'?'scope4':model==='radarscope2hd'?'scope2hd':'super';let url;if(radial&&this.app.map.radarScopeBufferUrl){const resource=this.app.map.radarScopeBufferUrl(buffer,{imageOrigin:scopeOrigin(frame.metadata),profile,palette:paletteName});url=resource.url;(this.scopeReleases||(this.scopeReleases=[])).push(resource.release)}else{const blobUrl=URL.createObjectURL(new Blob([buffer],{type:'image/png'}));this.imageUrls.push(blobUrl);url=radial?scopeUrl(blobUrl,frame.metadata,profile,paletteName):blobUrl}const source=`${id}-image`;this.sourceIds.push(source);this.layerIds.push(id);this.rasterLayerIds.push(id);map.addSource(source,{type:'image',url,coordinates:frame.metadata.coordinates});map.addLayer({id,type:'raster',source,paint:{'raster-resampling':'nearest','raster-fade-duration':0,'raster-opacity':opacity}},before);return;
    }
    const colors=gradientColors(paletteName),layer=new PolarLayer(frame.metadata,frame.buffer,{id,colors});layer.opacity=opacity;this.layers.push(layer);this.layerIds.push(id);map.addLayer(layer,before);
  }
  legend(product){const scale=document.querySelector('.dbz-scale'),name=$('paletteSelect').value,colors=gradientColors(name).length?gradientColors(name):palette(product);this.sourceLegend?.remove();this.sourceLegend=null;scale.hidden=false;scale.style.background=`linear-gradient(90deg,${colors.flatMap((color,index)=>[`${color} ${index/colors.length*100}%`,`${color} ${(index+1)/colors.length*100}%`]).join(',')})`;document.querySelector('.dbz-legend strong').textContent=product==='velocity'?'Velocidade Doppler':(RADAR_STYLES[name]?.label||'dBZ');const row=document.querySelector('.dbz-values');if(!this.legendHTML)this.legendHTML=row.innerHTML;row.replaceChildren();for(const value of product==='velocity'?['−','0','+']:[5,20,35,50,65,70]){const span=document.createElement('span');span.textContent=value;row.append(span)}}
  async download(){if(!this.current)return this.status('Selecione uma varredura antes de exportar.',true);try{if($('downloadFormat').value==='png')return await this.app.map.downloadPng(`brasil-scope-v3-${this.current.metadata.product}.png`);const {GifEncoder}=await import('../GifEncoder.js');const restore=this.index;let encoder;if(this.play){clearInterval(this.play);this.play=null;this.app.ui.playing(false)}try{for(let i=0;i<this.frames.length&&this.active;i++){await this.show(i);if(this.index!==i)throw new Error('Não foi possível carregar todos os quadros.');await new Promise(resolve=>{this.app.map.map.once('render',resolve);this.app.map.map.triggerRepaint()});const frame=await this.app.map.captureFrame(1440,1440);if(!encoder)encoder=new GifEncoder(frame.width,frame.height,{delay:900,loop:0});encoder.addFrame(frame.data,900)}if(encoder)this.app.map.downloadBlob(encoder.finish(),'brasil-scope-v3.gif')}finally{await this.show(restore)}}catch(error){this.status(error.message,true)}}
  leave({source=this.saved?.source,switchSource=true}={}){this.active=false;this.sequence++;this.abort?.abort();clearInterval(this.refresh);clearInterval(this.play);clearTimeout(this.scrub);this.play=null;this.busy=false;this.app.ui.playing(false);this.removeLayers();this.current=null;this.cache.clear();this.processedCache.clear();this.volumeCache.clear();if(this.savedView){try{this.app.map.map.easeTo({pitch:this.savedView.pitch,bearing:this.savedView.bearing,duration:250})}catch{}this.savedView=null}this.panel?.remove();this.sourceLegend?.remove();document.querySelector('.dbz-scale').hidden=false;document.querySelector('.dbz-legend').style.display=this.legendDisplay;this.hidden.forEach(([element,value])=>element.hidden=value);this.handlers.forEach(([id,type,handler])=>$(id).removeEventListener(type,handler,true));Object.assign(this.app,this.originals);if(this.legendHTML)document.querySelector('.dbz-values').innerHTML=this.legendHTML;Object.assign(this.app.map,this.mapOriginals);this.app.setDopplerPaletteAvailability(false);if($('sourceSelect')&&source)$('sourceSelect').value=source;if(switchSource&&source)void this.app.switchSource(source)}
}
