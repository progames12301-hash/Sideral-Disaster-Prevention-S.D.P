import {CONFIG,MAP_THEMES} from '../config.js?v=20260905-boundaries3';
import {stylePaint,radarPalette} from '../RadarStyles.js?v=20260914-v5-clean25';
import {createV5PolarLayer} from './V5PolarLayer.js?v=20260914-v5-clean25';
import {createSuperResPolarLayer} from './SuperResPolarLayer.js?v=20261003-superres2';

function circleFeature(center,radiusKm,properties={}){const [lon,lat]=center;const points=[];const earth=6371;for(let i=0;i<=96;i++){const bearing=i*2*Math.PI/96;const d=radiusKm/earth;const lat1=lat*Math.PI/180,lon1=lon*Math.PI/180;const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(bearing));const lon2=lon1+Math.atan2(Math.sin(bearing)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));points.push([lon2*180/Math.PI,lat2*180/Math.PI])}return {type:'Feature',properties,geometry:{type:'Polygon',coordinates:[points]}}}
function destinationPoint(center,bearingDeg,distanceKm){const [lon,lat]=center,earth=6371,bearing=bearingDeg*Math.PI/180,distance=distanceKm/earth,lat1=lat*Math.PI/180,lon1=lon*Math.PI/180;const lat2=Math.asin(Math.sin(lat1)*Math.cos(distance)+Math.cos(lat1)*Math.sin(distance)*Math.cos(bearing));const lon2=lon1+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(lat1),Math.cos(distance)-Math.sin(lat1)*Math.sin(lat2));return [((lon2*180/Math.PI+540)%360)-180,lat2*180/Math.PI]}
function mercatorY(latitude){const sin=Math.sin(Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180);return .5-Math.log((1+sin)/(1-sin))/(4*Math.PI)}
function scopeImageOrigin(layer,fallback){const radar=layer.radar&&Number.isFinite(Number(layer.radar.longitude))&&Number.isFinite(Number(layer.radar.latitude))?[Number(layer.radar.longitude),Number(layer.radar.latitude)]:fallback;if(!radar||!Array.isArray(layer.coordinates)||layer.coordinates.length<4)return [.5,.5];const west=Number(layer.coordinates[0][0]),east=Number(layer.coordinates[1][0]),north=Number(layer.coordinates[0][1]),south=Number(layer.coordinates[2][1]);const northY=mercatorY(north),southY=mercatorY(south);return [(radar[0]-west)/(east-west),(mercatorY(radar[1])-northY)/(southY-northY)]}
function radarScopeUrl(url,{origin=[0,0],imageOrigin=null,profile='scope',palette=null}={}){
  const value=String(url||''),http=value.match(/^(https?):\/\/(.+)$/i),density=['super','scope2hd','scope4','scope5','superres','brazil','brazil2','hub'].includes(profile)?profile:'scope';
  const palettePart=palette&&radarPalette(palette)?`&sideral_palette=${encodeURIComponent(palette)}`:'';
  if(http){
    const separator=value.includes('?')?'&':'?';
    const scope=imageOrigin?`image,${imageOrigin[0]},${imageOrigin[1]},${density}`:`geo,${origin[0]},${origin[1]},${density}`;
    return `radarscope://${http[1].toLowerCase()}/${http[2]}${separator}sideral_scope=${scope}${palettePart}`;
  }
  if(value.startsWith('blob:')){
    return `radarscope://blob/${encodeURIComponent(value)}?sideral_scope=image,${imageOrigin?.[0]??.5},${imageOrigin?.[1]??.5},${density}${palettePart}`;
  }
  return value;
}
function parseScopeRequest(value){
  const scopeMatch=value.match(/[?&]sideral_scope=([^&]+)/);
  if(!scopeMatch)throw new Error('Origem da varredura radial ausente.');
  const paletteMatch=value.match(/[?&]sideral_palette=([^&]+)/);
  const palette=paletteMatch?decodeURIComponent(paletteMatch[1]):null;
  const scope=decodeURIComponent(scopeMatch[1]).split(',');
  let clean=value
    .replace(/([?&])sideral_scope=[^&]*&?/,(_,separator)=>separator)
    .replace(/([?&])sideral_palette=[^&]*&?/,(_,separator)=>separator)
    .replace(/[?&]$/,'');
  if(clean.startsWith('radarscope://blob/'))return {url:decodeURIComponent(clean.slice('radarscope://blob/'.length)),scope,palette};
  if(clean.startsWith('radarscope://memory/')){
    const id=clean.slice('radarscope://memory/'.length),buffer=radarScopeSourceBuffers.get(id);
    if(!buffer)throw new Error('Quadro radial liberado antes do processamento.');
    return {buffer,scope,palette};
  }
  const match=clean.match(/^radarscope:\/\/(https?)\/(.+)$/i);
  if(!match)throw new Error('Endereço da varredura radial inválido.');
  return {url:`${match[1]}://${match[2]}`,scope,palette};
}

function radialOrigin(scope,width,height,url=''){
  if(scope?.[0]==='image'){
    const x=Number(scope[1]),y=Number(scope[2]);
    return [Number.isFinite(x)?x*width:width/2,Number.isFinite(y)?y*height:height/2];
  }
  if(scope?.[0]==='geo'){
    const longitude=Number(scope[1]),latitude=Number(scope[2]);
    const tile=String(url).match(/\/(?:256|512)\/(\d{1,2})\/(\d+)\/(\d+)\//);
    if(Number.isFinite(longitude)&&Number.isFinite(latitude)&&tile){
      const zoom=Number(tile[1]),tileX=Number(tile[2]),tileY=Number(tile[3]),world=2**zoom;
      const x=(longitude+180)/360*world;
      const y=mercatorY(latitude)*world;
      return [(x-tileX)*width,(y-tileY)*height];
    }
  }
  return [width/2,height/2];
}

const SOURCE_REFLECTIVITY_COLORS=Object.freeze([
  {dbz:5,rgb:[4,233,231]},{dbz:10,rgb:[1,159,244]},{dbz:15,rgb:[3,0,244]},
  {dbz:20,rgb:[2,253,2]},{dbz:25,rgb:[1,197,1]},{dbz:30,rgb:[0,142,0]},
  {dbz:35,rgb:[254,254,0]},{dbz:40,rgb:[253,149,0]},{dbz:45,rgb:[253,0,0]},
  {dbz:50,rgb:[212,0,0]},{dbz:55,rgb:[188,0,0]},{dbz:60,rgb:[248,0,253]},
  {dbz:65,rgb:[152,84,198]},{dbz:70,rgb:[255,255,255]}
]);

const COLOR_BIN_COUNT=32*32*32;
const NO_ECHO=255;
const protocolRasterCache=new Map();
const radarScopeSourceBuffers=new Map();
const paletteRgbCache=new Map();
const radarProcessingQueue=[];
let radarProcessingActive=0;
const RADAR_PROCESSING_LIMIT=Number(globalThis.navigator?.deviceMemory||4)<=4?1:2;

async function withRadarProcessingSlot(producer){
  if(radarProcessingActive>=RADAR_PROCESSING_LIMIT)await new Promise(resolve=>radarProcessingQueue.push(resolve));
  radarProcessingActive++;
  try{return await producer()}
  finally{radarProcessingActive--;radarProcessingQueue.shift()?.()}
}

function colorKey(red,green,blue){return ((red>>3)<<10)|((green>>3)<<5)|(blue>>3)}
function colorDistance(red,green,blue,target){
  const dr=red-target[0],dg=green-target[1],db=blue-target[2];
  return dr*dr*2+dg*dg*4+db*db;
}

const reflectivityLookup=(()=>{
  const table=new Uint8Array(COLOR_BIN_COUNT);
  table.fill(NO_ECHO);
  for(let key=0;key<COLOR_BIN_COUNT;key++){
    const red=Math.round(((key>>10)&31)*255/31);
    const green=Math.round(((key>>5)&31)*255/31);
    const blue=Math.round((key&31)*255/31);
    const max=Math.max(red,green,blue),min=Math.min(red,green,blue),saturation=max-min;
    if(max<18||(saturation<12&&max<235))continue;
    let best=NO_ECHO,bestDistance=42000;
    for(let index=0;index<SOURCE_REFLECTIVITY_COLORS.length;index++){
      const distance=colorDistance(red,green,blue,SOURCE_REFLECTIVITY_COLORS[index].rgb);
      if(distance<bestDistance){bestDistance=distance;best=index}
    }
    table[key]=best;
  }
  return table;
})();

function echoCode(data,index){
  if(data[index+3]<18)return NO_ECHO;
  return reflectivityLookup[colorKey(data[index],data[index+1],data[index+2])];
}
function isRadarEcho(data,index){return echoCode(data,index)!==NO_ECHO}
function isRenderableSourceGate(data,index){
  if(data[index+3]<18)return false;
  const red=data[index],green=data[index+1],blue=data[index+2];
  return Math.max(red,green,blue)>=18&&Math.max(red,green,blue)-Math.min(red,green,blue)>=8;
}

function paletteRgb(styleName){
  if(paletteRgbCache.has(styleName))return paletteRgbCache.get(styleName);
  const palette=radarPalette(styleName);
  if(!palette?.colors?.length){paletteRgbCache.set(styleName,null);return null}
  const colors=palette.colors.map(value=>{
    const number=parseInt(value.slice(1),16);
    return [(number>>16)&255,(number>>8)&255,number&255];
  });
  const mapped=SOURCE_REFLECTIVITY_COLORS.map((entry,index)=>{
    const normalized=index/(SOURCE_REFLECTIVITY_COLORS.length-1);
    return colors[Math.min(colors.length-1,Math.round(normalized*(colors.length-1)))];
  });
  paletteRgbCache.set(styleName,mapped);
  return mapped;
}
function paintEcho(output,target,source,sample,palette){
  const code=echoCode(source,sample);
  if(code===NO_ECHO){
    output[target]=source[sample];output[target+1]=source[sample+1];output[target+2]=source[sample+2];output[target+3]=source[sample+3];
    return;
  }
  const color=palette?.[code];
  if(color){
    output[target]=color[0];output[target+1]=color[1];output[target+2]=color[2];
  }else{
    output[target]=source[sample];output[target+1]=source[sample+1];output[target+2]=source[sample+2];
  }
  output[target+3]=source[sample+3];
}
function paintGateDepth(output,target,source,sample,palette,depth,width){
  // Pequena queda visual abaixo do gate, como nas placas do RadarScope.
  // É somente um tratamento 2D; não cria relevo nem altera coordenadas.
  const alpha=Math.min(120,Math.max(28,source[sample+3]>>1));
  for(let step=1;step<=depth;step++){
    const index=target+step*width*4;
    if(index<0||index>=output.length||output[index+3])continue;
    const code=echoCode(source,sample),color=palette?.[code];
    if(color){output[index]=color[0];output[index+1]=color[1];output[index+2]=color[2]}else{output[index]=source[sample];output[index+1]=source[sample+1];output[index+2]=source[sample+2]}
    output[index+3]=alpha;
  }
}
function paintBrazilMirror(output,target,source,sample,palette,shade){
  const code=echoCode(source,sample),color=palette?.[code];
  const red=color?.[0]??source[sample],green=color?.[1]??source[sample+1],blue=color?.[2]??source[sample+2];
  output[target]=Math.round(red*shade);
  output[target+1]=Math.round(green*shade);
  output[target+2]=Math.round(blue*shade);
  output[target+3]=source[sample+3];
}

function brazilMirrorScale(width,height,target=2048){
  // Mais texels para desenhar as bordas; as amostras continuam na grade original.
  const dimension=Math.max(width,height),memory=Number(globalThis.navigator?.deviceMemory||4);
  return Math.max(1,Math.min(memory<=2?2:4,(memory<=2?1024:target)/dimension));
}

async function renderBrazilMirrors(source,width,height,center,styleName,laidDown=false,uniform=false,highDefinition=false){
  // Espelhos alongados no sentido radial; a largura abre com a distancia.
  const outputScale=brazilMirrorScale(width,height,highDefinition?3072:2048);
  const outputWidth=Math.max(1,Math.round(width*outputScale));
  const outputHeight=Math.max(1,Math.round(height*outputScale));
  const scaleX=outputWidth/width,scaleY=outputHeight/height;
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  const [centerX,centerY]=center;
  const dimension=Math.max(width,height);
  const rasterScale=Math.max(.75,Math.min(3,dimension/400));
  const azimuthResolution=(highDefinition?.12:laidDown?.42:.22)*Math.PI/180;
  // Perto da antena os espelhos ficam mais compridos (====); para fora,
  // diminuem para preservar o recorte meteorologico da imagem original.
  const nearRange=(highDefinition?2.5:uniform?2.6:laidDown?3.2:4.8)*rasterScale,midRange=(highDefinition?1.8:uniform?2.6:laidDown?2.5:3.55)*rasterScale,farRange=(highDefinition?1.15:uniform?2.6:laidDown?1.8:2.45)*rasterScale;
  const nearEnd=Math.ceil((dimension*.14)/nearRange)*nearRange;
  const midEnd=nearEnd+Math.ceil((dimension*.27)/midRange)*midRange;
  const palette=paletteRgb(styleName);

  for(let outputY=0;outputY<outputHeight;outputY++){
    const sourceY=(outputY+.5)/scaleY-.5,dy=sourceY-centerY,row=outputY*outputWidth*4;
    for(let outputX=0;outputX<outputWidth;outputX++){
      const sourceX=(outputX+.5)/scaleX-.5,dx=sourceX-centerX,radius=Math.hypot(dx,dy);
      const original=(Math.max(0,Math.min(height-1,Math.round(sourceY)))*width+Math.max(0,Math.min(width-1,Math.round(sourceX))))*4;
      if(!radarEchoPixel(source,original))continue;
      const angle=Math.atan2(dy,dx);
      const azimuthIndex=Math.floor((angle+Math.PI)/azimuthResolution);
      const thetaCenter=(azimuthIndex+.5)*azimuthResolution-Math.PI;
      let rangeResolution,rangeOrigin;
      if(radius<nearEnd){rangeResolution=nearRange;rangeOrigin=0}
      else if(radius<midEnd){rangeResolution=midRange;rangeOrigin=nearEnd}
      else{rangeResolution=farRange;rangeOrigin=midEnd}
      const rangeIndex=Math.floor((radius-rangeOrigin)/rangeResolution);
      const rangeStart=rangeOrigin+rangeIndex*rangeResolution;
      const rangeCenter=rangeStart+rangeResolution*.5;
      const sampleX=Math.round(centerX+Math.cos(thetaCenter)*rangeCenter);
      const sampleY=Math.round(centerY+Math.sin(thetaCenter)*rangeCenter);
      if(sampleX<0||sampleX>=width||sampleY<0||sampleY>=height)continue;
      const sample=(sampleY*width+sampleX)*4;
      if(!radarEchoPixel(source,sample))continue;

      // A depressao perto da antena e apenas tonal. Nao desenhamos contornos
      // radiais, pois eles virariam aneis artificiais em areas de eco continuo.
      const radialProgress=Math.min(1,radius/Math.max(1,dimension*.52));
      const depression=.9+.1*radialProgress;
      paintBrazilMirror(output,row+outputX*4,source,sample,palette,depression);
    }
    if((outputY&95)===95)await nextUiTurn();
  }
  return {data:output,width:outputWidth,height:outputHeight};
}

export async function renderScopeV4Gates(source,width,height,center,styleName){
  // Reprojeta somente gates existentes na fonte. O V4 nao inventa ruido,
  // ecos fracos ou variacoes de cor: a textura fina vem da geometria polar.
  const outputScale=brazilMirrorScale(width,height,2560);
  const outputWidth=Math.max(1,Math.round(width*outputScale));
  const outputHeight=Math.max(1,Math.round(height*outputScale));
  const scaleX=outputWidth/width,scaleY=outputHeight/height;
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  const [centerX,centerY]=center;
  const dimension=Math.max(width,height),rasterScale=Math.max(.75,Math.min(3,dimension/400));
  const azimuthResolution=.09*Math.PI/180;
  const rangeResolution=1.15*rasterScale;
  const palette=paletteRgb(styleName);

  for(let outputY=0;outputY<outputHeight;outputY++){
    const sourceY=(outputY+.5)/scaleY-.5,dy=sourceY-centerY,row=outputY*outputWidth*4;
    for(let outputX=0;outputX<outputWidth;outputX++){
      const sourceX=(outputX+.5)/scaleX-.5,dx=sourceX-centerX,radius=Math.hypot(dx,dy);
      const angle=Math.atan2(dy,dx),azimuthPosition=(angle+Math.PI)/azimuthResolution;
      const rangePosition=radius/rangeResolution;
      const ray=Math.floor(azimuthPosition),gate=Math.floor(rangePosition);
      const thetaCenter=(ray+.5)*azimuthResolution-Math.PI;
      const rangeCenter=(gate+.5)*rangeResolution;
      const sampleX=Math.round(centerX+Math.cos(thetaCenter)*rangeCenter);
      const sampleY=Math.round(centerY+Math.sin(thetaCenter)*rangeCenter);
      if(sampleX<0||sampleX>=width||sampleY<0||sampleY>=height)continue;
      const sample=(sampleY*width+sampleX)*4;
      const target=row+outputX*4;
      if(!isRenderableSourceGate(source,sample))continue;
      // paintEcho conserva a cor original quando o gate e fraco demais para
      // a tabela de classes, em vez de descarta-lo ou criar uma cor nova.
      paintEcho(output,target,source,sample,palette);
    }
    if((outputY&95)===95)await nextUiTurn();
  }
  return {data:output,width:outputWidth,height:outputHeight};
}

export async function renderScopeV5Gates(source,width,height,center,styleName){
  const outputScale=brazilMirrorScale(width,height,4096),outputWidth=Math.max(1,Math.round(width*outputScale)),outputHeight=Math.max(1,Math.round(height*outputScale));
  const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(outputWidth,outputHeight):Object.assign(document.createElement('canvas'),{width:outputWidth,height:outputHeight});
  const ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,outputWidth,outputHeight);
  const [cx,cy]=center,scaleX=outputWidth/width,scaleY=outputHeight/height,palette=paletteRgb(styleName);
  // V5: 720 azimutes de 0,5° e 1000 gates de profundidade radial constante
  // (referência física de 250 m em um alcance de 250 km).
  const maxRadius=Math.hypot(Math.max(cx,width-cx),Math.max(cy,height-cy));
  const azimuthCount=720,azimuthWidth=(360/azimuthCount)*Math.PI/180;
  const gateCount=1000,gateDepth=Math.max(1,maxRadius/gateCount);
  for(let ai=0;ai<azimuthCount;ai++){
    const a0=ai*azimuthWidth-Math.PI,a1=a0+azimuthWidth;
    for(let gi=0;gi<gateCount;gi++){
      // Quatro vértices formam o "espelho" polar. A espessura radial é fixa;
      // a largura aparente cresce naturalmente com r (r × Δθ), por isso os
      // espelhos ficam finos no centro e mais largos no fim do alcance.
      const r0=gi*gateDepth,r1=r0+gateDepth,rm=(r0+r1)/2, sx=Math.round(cx+Math.cos((a0+a1)/2)*rm),sy=Math.round(cy+Math.sin((a0+a1)/2)*rm);
      if(sx<0||sx>=width||sy<0||sy>=height)continue;const sample=(sy*width+sx)*4;if(!isRenderableSourceGate(source,sample))continue;const color=palette[echoCode(source,sample)]||[0,0,0,0];
      ctx.fillStyle=`rgba(${color[0]},${color[1]},${color[2]},${(source[sample+3]??255)/255})`;ctx.beginPath();
      for(const [r,a] of [[r0,a0],[r1,a0],[r1,a1],[r0,a1]]){const x=(cx+Math.cos(a)*r)*scaleX,y=(cy+Math.sin(a)*r)*scaleY;if(r===r0&&a===a0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.closePath();ctx.fill();
    }
    if((ai&15)===15)await nextUiTurn();
  }
  const pixels=ctx.getImageData(0,0,outputWidth,outputHeight);return {data:pixels.data,width:outputWidth,height:outputHeight};
}

async function renderScopeV5RasterGates(source,width,height,center,styleName){
  // Gates com profundidade radial constante. A largura angular abre com a
  // distancia, preservando o mesmo tamanho fisico da celula no mapa.
  const outputScale=brazilMirrorScale(width,height,4096);
  const outputWidth=Math.max(1,Math.round(width*outputScale));
  const outputHeight=Math.max(1,Math.round(height*outputScale));
  const scaleX=outputWidth/width,scaleY=outputHeight/height;
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  const [centerX,centerY]=center;
  // A gate is a real polar rectangle: fixed radial depth, fixed 0.5° beam.
  // Keep the radial depth visibly larger than a pixel so the texture reads as
  // elongated radar gates instead of a field of tiny squares.
  const gateSize=Math.max(9,Math.min(13,Math.max(width,height)/115)),azimuthStep=.5*Math.PI/180;
  const palette=paletteRgb(styleName);
  for(let outputY=0;outputY<outputHeight;outputY++){
    const sourceY=(outputY+.5)/scaleY-.5,dy=sourceY-centerY,row=outputY*outputWidth*4;
    for(let outputX=0;outputX<outputWidth;outputX++){
      const sourceX=(outputX+.5)/scaleX-.5,dx=sourceX-centerX,radius=Math.hypot(dx,dy);
      if(radius<.5)continue;
      const angle=Math.atan2(dy,dx);
      const angleIndex=Math.floor((angle+Math.PI)/azimuthStep),angleCenter=(angleIndex+.5)*azimuthStep-Math.PI;
      // Amostragem contínua no raio: não cria anéis concêntricos artificiais.
      const sampleX=Math.round(centerX+Math.cos(angleCenter)*radius),sampleY=Math.round(centerY+Math.sin(angleCenter)*radius);
      if(sampleX<0||sampleX>=width||sampleY<0||sampleY>=height)continue;
      const sample=(sampleY*width+sampleX)*4;
      if(!isRenderableSourceGate(source,sample))continue;
      paintEcho(output,row+outputX*4,source,sample,palette);
    }
    if((outputY&95)===95)await nextUiTurn();
  }
  return {data:output,width:outputWidth,height:outputHeight};
}

function nextUiTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

async function recolorReflectivity(source,styleName,width,height){
  const palette=paletteRgb(styleName);
  if(!palette)return source;
  const variableAlpha=styleName==='wx_radiais';
  const output=new Uint8ClampedArray(source);
  for(let y=0;y<height;y++){
    const row=y*width*4;
    for(let x=0;x<width;x++){
      const index=row+x*4,code=echoCode(source,index);
      if(code===NO_ECHO)continue;
      const color=palette[code];
      output[index]=color[0];output[index+1]=color[1];output[index+2]=color[2];
      if(variableAlpha){
        // Ecos fracos deixam o mapa visível; núcleos fortes permanecem opacos.
        const alpha=[64,76,92,112,140,170,195,218,235,245,250,252,255,255][code]??255;
        output[index+3]=Math.min(output[index+3],alpha);
      }
    }
    if((y&127)===127)await nextUiTurn();
  }
  return output;
}

function wxToolsUrl(url,styleName){
  const value=String(url||'');
  if(!styleName?.startsWith('wx_')||!radarPalette(styleName))return value;
  if(value.startsWith('blob:'))return `wxtools://blob/${encodeURIComponent(value)}?sideral_palette=${encodeURIComponent(styleName)}`;
  const match=value.match(/^(https?):\/\/(.+)$/i);
  if(!match)return value;
  const separator=value.includes('?')?'&':'?';
  return `wxtools://${match[1].toLowerCase()}/${match[2]}${separator}sideral_palette=${encodeURIComponent(styleName)}`;
}
function parseWxToolsRequest(value){
  const paletteMatch=value.match(/[?&]sideral_palette=([^&]+)/);
  if(!paletteMatch)throw new Error('Paleta WxTools ausente.');
  const styleName=decodeURIComponent(paletteMatch[1]);
  const clean=value.replace(/([?&])sideral_palette=[^&]*&?/,(_,separator)=>separator).replace(/[?&]$/,'');
  if(clean.startsWith('wxtools://blob/'))return {url:decodeURIComponent(clean.slice('wxtools://blob/'.length)),styleName};
  const match=clean.match(/^wxtools:\/\/(https?)\/(.+)$/i);
  if(!match)throw new Error('Endereço WxTools inválido.');
  return {url:`${match[1]}://${match[2]}`,styleName};
}
function cachedProtocol(key,producer){
  if(protocolRasterCache.has(key))return protocolRasterCache.get(key);
  const promise=Promise.resolve().then(producer).catch(error=>{protocolRasterCache.delete(key);throw error});
  protocolRasterCache.set(key,promise);
  while(protocolRasterCache.size>72)protocolRasterCache.delete(protocolRasterCache.keys().next().value);
  return promise;
}
function registerWxToolsProtocol(){
  if(globalThis.__sideralWxToolsProtocol)return;
  globalThis.__sideralWxToolsProtocol=true;
  maplibregl.addProtocol('wxtools',async(params,abortController)=>{
    const data=await cachedProtocol(params.url,async()=>{
      const request=parseWxToolsRequest(params.url);
      const response=await fetch(request.url,{signal:abortController?.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const original=await response.arrayBuffer();
      if(typeof createImageBitmap!=='function')return original;
      const bitmap=await createImageBitmap(new Blob([original],{type:response.headers.get('content-type')||'image/png'}));
      const width=bitmap.width,height=bitmap.height;
      const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
      const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true});
      context.imageSmoothingEnabled=false;context.clearRect(0,0,width,height);context.drawImage(bitmap,0,0);bitmap.close?.();
      const image=context.getImageData(0,0,width,height);
      image.data.set(await recolorReflectivity(image.data,request.styleName,width,height));
      context.putImageData(image,0,0);
      const output=canvas.convertToBlob?await canvas.convertToBlob({type:'image/png'}):await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao aplicar paleta.')),'image/png'));
      return await output.arrayBuffer();
    });
    return {data};
  });
}

function radarEchoPixel(data,index){return isRadarEcho(data,index)}

async function renderPolarGates(source,width,height,center,profile='scope',styleName=null){
  // Todos os modos polares compartilham a mesma malha de gates retangulares.
  // O modo continua controlando a paleta, mas a qualidade de perto não muda.
  // O V5 real é renderizado pela camada WebGL geográfica. Tiles sem origem
  // individual permanecem nativos em vez de receber uma falsa grade raster.
  if(profile==='scope5'||profile==='superres')return {data:source,width,height};
  if(profile==='scope4')return renderScopeV4Gates(source,width,height,center,styleName);
  if(['brazil','brazil2','hub','scope2hd'].includes(profile))return renderBrazilMirrors(source,width,height,center,styleName,false,false,profile==='scope2hd');
  // Saída inicia transparente: apenas gates cujo ponto central contém eco
  // são preenchidos. Não existem anéis, linhas de alcance ou fundo sintético.
  const scale=brazilMirrorScale(width,height);
  const outputWidth=Math.round(width*scale),outputHeight=Math.round(height*scale);
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  const [centerX,centerY]=center;
  const dimension=Math.max(width,height);
  const superResolution=profile==='super';
  // Gates mais densos preservam a textura polar do RadarScope. A largura
  // angular menor aumenta a quantidade de placas sem criar ecos novos: cada
  // gate continua consultando somente a amostra real do CAPPI.
  const azimuthResolution=(superResolution?0.12:0.22)*Math.PI/180;
  // Os PNGs CAPPI da REDEMET têm normalmente 400×400 px para um diâmetro
  // próximo de 500 km. Escalar a profundidade do gate pelo tamanho real do
  // raster conserva a mesma aparência de placas radiais em outras resoluções.
  const rasterScale=Math.max(.75,Math.min(3,dimension/400));
  const rangeResolution=(superResolution?1.35:2.0)*rasterScale;
  const palette=paletteRgb(styleName);

  for(let y=0;y<outputHeight;y++){
    const row=y*outputWidth*4;
    for(let x=0;x<outputWidth;x++){
      const target=row+x*4;
      const sx=(x+.5)*width/outputWidth-.5,sy=(y+.5)*height/outputHeight-.5;
      const original=(Math.max(0,Math.min(height-1,Math.round(sy)))*width+Math.max(0,Math.min(width-1,Math.round(sx))))*4;
      if(!radarEchoPixel(source,original))continue;
      const dx=sx-centerX,dy=sy-centerY,radius=Math.hypot(dx,dy);
      const angle=Math.atan2(dy,dx);
      const azimuthIndex=Math.floor((angle+Math.PI)/azimuthResolution);
      const rangeIndex=Math.floor(radius/rangeResolution);
      const thetaCenter=(azimuthIndex+.5)*azimuthResolution-Math.PI;
      const rangeCenter=(rangeIndex+.5)*rangeResolution;
      const sampleX=Math.round(centerX+Math.cos(thetaCenter)*rangeCenter);
      const sampleY=Math.round(centerY+Math.sin(thetaCenter)*rangeCenter);
      if(sampleX<0||sampleX>=width||sampleY<0||sampleY>=height)continue;
      const sample=(sampleY*width+sampleX)*4;
      if(!radarEchoPixel(source,sample))continue;
      paintEcho(output,target,source,sample,palette);
    }
    if((y&95)===95)await nextUiTurn();
  }
  return {data:output,width:outputWidth,height:outputHeight};
}

function registerRadarScopeProtocol(){
  if(globalThis.__sideralRadarScopeProtocol)return;
  globalThis.__sideralRadarScopeProtocol=true;
  maplibregl.addProtocol('radarscope',async(params,abortController)=>{
    const data=await cachedProtocol(params.url,async()=>{
      const request=parseScopeRequest(params.url);
      let original,contentType='image/png';
      if(request.buffer)original=request.buffer;
      else{
        const response=await fetch(request.url,{signal:abortController?.signal});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        original=await response.arrayBuffer();contentType=response.headers.get('content-type')||contentType;
      }
      if(typeof createImageBitmap!=='function')return original;

      return withRadarProcessingSlot(async()=>{
        try{
          const bitmap=await createImageBitmap(new Blob([original],{type:contentType}));
          const width=bitmap.width,height=bitmap.height;
          const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
          const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true});
          if(!context){bitmap.close?.();return original}
          context.imageSmoothingEnabled=false;context.clearRect(0,0,width,height);context.drawImage(bitmap,0,0);bitmap.close?.();
          const image=context.getImageData(0,0,width,height);
          const rendered=await renderPolarGates(image.data,width,height,radialOrigin(request.scope,width,height,request.url),request.scope[3],request.palette);
          canvas.width=rendered.width;canvas.height=rendered.height;
          const outputContext=canvas.getContext('2d',{alpha:true,willReadFrequently:false});
          if(!outputContext)return original;
          outputContext.imageSmoothingEnabled=false;
          const outputImage=outputContext.createImageData(rendered.width,rendered.height);
          outputImage.data.set(rendered.data);
          outputContext.putImageData(outputImage,0,0);
          const output=canvas.convertToBlob?await canvas.convertToBlob({type:'image/png'}):await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao montar radar.')),'image/png'));
          return await output.arrayBuffer();
        }catch(error){
          console.warn('Pixelização polar indisponível; usando a imagem original.',error);
          return original;
        }
      });
    });
    return {data};
  });
}

function stableRadarId(value){let hash=2166136261;for(const character of String(value)){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619)}return `radar-cache-${(hash>>>0).toString(36)}`}

export class MapManager{
  constructor(container,onStyleReady){
    registerRadarScopeProtocol();registerWxToolsProtocol();this.theme='light';this.radarLayers=[];this.radarPool=new Set();this.pendingRadarLayers=new Set();this.radarLayerOptions=new Map();this.v5PolarLayers=new Map();this.radarTransition=0;this.styleName='normal';this.opacity=.8;this.radarScopeMode=false;this.radarScopeProfile='scope';this.radarScopeOrigin=CONFIG.center.slice();this.onStyleReady=onStyleReady;this.stormTrackData=null;this.stormTrackPicker=null;this.radarPicker=null;this.radarCatalog=[];this.boundaries={states:null,municipalities:null};this.boundaryVisible={states:true,municipalities:false};this.boundaryLoading={states:null,municipalities:null};
    this.map=new maplibregl.Map({container,style:this.baseStyle(this.theme),center:CONFIG.center,zoom:3.6,pitch:0,bearing:0,maxPitch:70,renderWorldCopies:false,attributionControl:true,dragRotate:true,pitchWithRotate:true,touchPitch:true,preserveDrawingBuffer:true,canvasContextAttributes:{preserveDrawingBuffer:true}});
    this.map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
    this.map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-right');
    this.setDisplayQuality('extreme');
    this.ready=new Promise(resolve=>this.map.once('load',resolve));
    this.satelliteTiles=null;this.satelliteCanvas=null;
    this.map.on('style.load',()=>{void this.restoreBoundaryLayers();this.restoreSatelliteTiles();if(this.radarCatalog.length)this.setRadarMarkers(this.radarCatalog);if(this.stormTrackData)this.drawStormTrack();if(this.onStyleReady)requestAnimationFrame(()=>this.onStyleReady())});
    this.map.on('click',event=>{const radar=this.map.getLayer('radar-centers')?this.map.queryRenderedFeatures(event.point,{layers:['radar-centers']})[0]:null;if(radar&&this.radarPicker){this.radarPicker(radar.properties);return}if(this.stormTrackPicker)this.stormTrackPicker({lng:event.lngLat.lng,lat:event.lngLat.lat})});
    this.map.on('mousemove',event=>{const overRadar=this.map.getLayer('radar-centers')&&this.map.queryRenderedFeatures(event.point,{layers:['radar-centers']}).length;this.map.getCanvas().style.cursor=overRadar?'pointer':this.stormTrackPicker?'crosshair':''});
  }
  radarScopeBufferUrl(buffer,{imageOrigin=[.5,.5],profile='super',palette=null}={}){
    const id=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    radarScopeSourceBuffers.set(id,buffer);
    const palettePart=palette&&radarPalette(palette)?`&sideral_palette=${encodeURIComponent(palette)}`:'';
    return {url:`radarscope://memory/${id}?sideral_scope=image,${imageOrigin[0]},${imageOrigin[1]},${profile}${palettePart}`,release:()=>radarScopeSourceBuffers.delete(id)};
  }
  baseStyle(theme){const selected=MAP_THEMES[theme]||MAP_THEMES.light;const paints={light:{'raster-saturation':-.12,'raster-brightness-min':0,'raster-brightness-max':.9,'raster-contrast':.08},gray:{'raster-saturation':-1,'raster-brightness-min':.08,'raster-brightness-max':.82,'raster-contrast':.14},dark:{'raster-saturation':-.12,'raster-brightness-min':0,'raster-brightness-max':.9,'raster-contrast':.08},satellite:{'raster-saturation':-.12,'raster-brightness-min':0,'raster-brightness-max':.88,'raster-contrast':.1}};return {version:8,sources:{basemap:{type:'raster',tiles:selected.tiles,tileSize:256,attribution:selected.attribution}},layers:[{id:'basemap',type:'raster',source:'basemap',paint:{...(paints[theme]||paints.light),'raster-fade-duration':0}}]}}
  setTheme(theme){this.theme=MAP_THEMES[theme]?theme:'light';this.clearRadar();this.map.setStyle(this.baseStyle(this.theme),{diff:false})}
  setSatelliteTiles(options){
    if(!options?.template&&(!options?.date||!options?.product))return false;
    this.satelliteTiles={date:String(options.date||''),product:String(options.product||''),opacity:Number.isFinite(Number(options.opacity))?Number(options.opacity):.9,base:String(options.base||''),template:String(options.template||''),attribution:String(options.attribution||'Satélite'),maxzoom:Number.isFinite(Number(options.maxzoom))?Number(options.maxzoom):7,resampling:options.resampling==='nearest'?'nearest':'linear',contrast:Number(options.contrast)||0,saturation:Number(options.saturation)||0};
    return this.satelliteTiles.template?this.stageSatelliteTiles(this.satelliteTiles):this.restoreSatelliteTiles();
  }
  clearSatelliteTiles(){
    if(this.satellitePromote)this.map.off('sourcedata',this.satellitePromote);
    this.satelliteTiles=null;
    this.satelliteCanvas=null;
    const ids=['satellite-reference-labels','satellite-reference-countries','satellite-image','satellite-grid',...(this.satelliteTileIds||[])];
    [...new Set(ids)].forEach(id=>{if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource(id))this.map.removeSource(id)});
    this.satelliteTileIds=[];this.satelliteActiveId=null;this.satellitePendingId=null;this.satellitePromote=null;
  }
  setSatelliteCanvas(canvas,bounds,opacity=.9){
    if(!canvas||!Array.isArray(bounds)||bounds.length!==4)return false;
    this.satelliteTiles=null;this.satelliteCanvas={canvas,bounds:bounds.map(Number),opacity:Math.max(0,Math.min(1,Number(opacity)||0))};
    const restored=this.restoreSatelliteCanvas();
    // CanvasSource com animate:false não detecta sozinho uma nova textura
    // desenhada pelo WebGL. Reproduza um frame de atualização sem deixar um
    // loop contínuo de repintura ativo.
    if(restored){
      const source=this.map.getSource('satellite-grid');
      source?.play?.();
      this.map.triggerRepaint();
      requestAnimationFrame(()=>source?.pause?.());
    }
    return restored;
  }
  restoreSatelliteCanvas(){
    if(!this.map.isStyleLoaded()||!this.satelliteCanvas)return false;
    if(this.map.getLayer('satellite-grid'))this.map.removeLayer('satellite-grid');
    if(this.map.getSource('satellite-grid'))this.map.removeSource('satellite-grid');
    const {canvas,bounds,opacity}=this.satelliteCanvas,[west,south,east,north]=bounds;
    this.map.addSource('satellite-grid',{type:'canvas',canvas,animate:false,coordinates:[[west,north],[east,north],[east,south],[west,south]]});
    const before=this.map.getStyle().layers.find(layer=>layer.id.startsWith('boundaries-'))?.id;
    this.map.addLayer({id:'satellite-grid',type:'raster',source:'satellite-grid',paint:{'raster-opacity':opacity,'raster-resampling':'nearest','raster-fade-duration':0}},before);
    return true;
  }
  setSatelliteOpacity(value){
    const opacity=Math.max(0,Math.min(1,Number(value)||0));
    if(this.satelliteTiles)this.satelliteTiles.opacity=opacity;
    if(this.satelliteCanvas)this.satelliteCanvas.opacity=opacity;
    if(this.map.getLayer('satellite-image'))this.map.setPaintProperty('satellite-image','raster-opacity',opacity);
    if(this.map.getLayer('satellite-grid'))this.map.setPaintProperty('satellite-grid','raster-opacity',opacity);
    (this.satelliteTileIds||[]).forEach(id=>{if(this.map.getLayer(id))this.map.setPaintProperty(id,'raster-opacity',id===this.satelliteActiveId?opacity:0)});
  }
  stageSatelliteTiles(tiles){
    if(!this.map.isStyleLoaded()||!tiles?.template)return false;
    if(this.satellitePromote)this.map.off('sourcedata',this.satellitePromote);
    const id=stableRadarId(`satellite-gibs:${tiles.template}`),old=this.satelliteActiveId;
    this.satelliteTileIds=this.satelliteTileIds||[];
    if(!this.map.getSource(id)){
      this.map.addSource(id,{type:'raster',tiles:[tiles.template],tileSize:256,minzoom:2,maxzoom:tiles.maxzoom,attribution:tiles.attribution});
      this.map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':old?0:tiles.opacity,'raster-resampling':tiles.resampling,'raster-contrast':tiles.contrast,'raster-saturation':tiles.saturation,'raster-fade-duration':180}});
      this.satelliteTileIds.push(id);
    }else if(this.map.getLayer(id))this.map.setPaintProperty(id,'raster-opacity',old===id?tiles.opacity:0);
    this.satellitePendingId=id;
    const promote=()=>{
      if(this.satellitePendingId!==id||!this.map.getSource(id))return;
      let ready=false;try{ready=this.map.isSourceLoaded(id)}catch{}
      if(!ready)return;
      if(this.map.getLayer(id))this.map.setPaintProperty(id,'raster-opacity',tiles.opacity);
      if(old&&old!==id&&this.map.getLayer(old)){
        this.map.setPaintProperty(old,'raster-opacity',0);
        setTimeout(()=>{if(this.satelliteActiveId===id){if(this.map.getLayer(old))this.map.removeLayer(old);if(this.map.getSource(old))this.map.removeSource(old);this.satelliteTileIds=this.satelliteTileIds.filter(value=>value!==old)}},220);
      }
      this.satelliteActiveId=id;this.satellitePendingId=null;
      ['boundaries-states-shadow','boundaries-states','boundaries-states-labels','boundaries-municipalities-shadow','boundaries-municipalities','boundaries-municipalities-labels'].forEach(layerId=>{if(this.map.getLayer(layerId))this.map.moveLayer(layerId)});
      this.map.off('sourcedata',promote);this.satellitePromote=null;
    };
    this.satellitePromote=promote;this.map.on('sourcedata',promote);requestAnimationFrame(promote);
    return true;
  }
  preloadSatelliteTiles(template,maxzoom=7){
    if(!template)return;
    const urls=this.visibleTileUrls({kind:'tiles',tiles:[template],maxzoom},1);
    urls.forEach(url=>{fetch(url,{mode:'cors',cache:'force-cache'}).catch(()=>{})});
  }
  waitForSatelliteTiles(timeout=9000){
    const id=this.satellitePendingId||this.satelliteActiveId;
    if(!id)return Promise.resolve(false);
    return new Promise(resolve=>{
      let done=false;
      const finish=loaded=>{if(done)return;done=true;clearTimeout(timer);this.map.off('sourcedata',check);resolve(loaded)};
      const check=()=>{
        if(!this.map.getSource(id))return finish(false);
        let loaded=false;try{loaded=this.map.isSourceLoaded(id)}catch{}
        if(loaded&&this.satellitePendingId!==id)finish(true);
      };
      const timer=setTimeout(()=>finish(false),timeout);
      this.map.on('sourcedata',check);
      check();
    });
  }
  restoreSatelliteTiles(){
    if(!this.map.isStyleLoaded())return false;
    ['satellite-reference-labels','satellite-reference-countries','satellite-image'].forEach(id=>{if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource(id))this.map.removeSource(id)});
    const tiles=this.satelliteTiles;if(!tiles)return this.restoreSatelliteCanvas();
    if(tiles.template){this.satelliteTileIds=[];this.satelliteActiveId=null;this.satellitePendingId=null;return this.stageSatelliteTiles(tiles)}
    const day=tiles.date.slice(0,8),time=tiles.date.slice(8,12),host=`${tiles.base}/api/cptec/satelite/tile`;
    const imageTemplate=tiles.template||`${host}/${day}/${tiles.product}/${time}/{z}/{x}/{y}.png`;
    const reference=(kind)=>`${host}/references/${kind}/{z}/{x}/{y}.png`;
    this.map.addSource('satellite-image',{type:'raster',tiles:[imageTemplate],tileSize:256,minzoom:2,maxzoom:tiles.maxzoom,attribution:tiles.attribution});
    this.map.addLayer({id:'satellite-image',type:'raster',source:'satellite-image',paint:{'raster-opacity':tiles.opacity,'raster-resampling':tiles.resampling,'raster-contrast':tiles.contrast,'raster-saturation':tiles.saturation,'raster-fade-duration':0}});
    this.map.addSource('satellite-reference-countries',{type:'raster',tiles:[reference('countries')],tileSize:256,minzoom:2,maxzoom:7});
    this.map.addLayer({id:'satellite-reference-countries',type:'raster',source:'satellite-reference-countries',paint:{'raster-opacity':.96,'raster-fade-duration':0}});
    this.map.addSource('satellite-reference-labels',{type:'raster',tiles:[reference('labels')],tileSize:256,minzoom:2,maxzoom:7});
    this.map.addLayer({id:'satellite-reference-labels',type:'raster',source:'satellite-reference-labels',paint:{'raster-opacity':.95,'raster-fade-duration':0}});
    return true;
  }
  async setBoundaries(kind,visible=true){
    if(!['states','municipalities'].includes(kind))return;
    this.boundaryVisible[kind]=Boolean(visible);
    if(!visible){this.removeBoundary(kind);return}
    if(!this.boundaries[kind]){
      if(this.boundaryLoading[kind]){
        await this.boundaryLoading[kind];
        if(this.boundaryVisible[kind]&&this.boundaries[kind])this.drawBoundary(kind);
        return;
      }
      this.boundaryLoading[kind]=this.loadBoundary(kind);
      try{this.boundaries[kind]=await this.boundaryLoading[kind]}catch(error){console.warn(`Limites ${kind} indisponíveis`,error);this.boundaries[kind]=null}
      this.boundaryLoading[kind]=null;
    }
    this.drawBoundary(kind);
  }
  async loadBoundary(kind){
    if(kind==='states'){
      const response=await fetch('./brazil-states.geojson',{cache:'force-cache'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();
    }
    const states=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
    const responses=await Promise.allSettled(states.map(async state=>{const response=await fetch(`https://cdn.jsdelivr.net/gh/henriquemalvar/br-geojson@main/dist/municipios/${state}.geojson`,{cache:'force-cache'});if(!response.ok)throw new Error(`HTTP ${response.status} ${state}`);return response.json()}));
    const data=responses.filter(result=>result.status==='fulfilled').map(result=>result.value);
    if(!data.length)throw new Error('Nenhum limite municipal disponível');
    return {type:'FeatureCollection',features:data.flatMap(value=>Array.isArray(value.features)?value.features:[])};
  }
  removeBoundary(kind){const source=`boundaries-${kind}`;for(const id of [`${source}-shadow`,source,`${source}-labels`])if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource(source))this.map.removeSource(source)}
  drawBoundary(kind){
    const data=this.boundaries[kind];if(!data||!this.map.getStyle()?.layers)return;
    const source=`boundaries-${kind}`;this.removeBoundary(kind);this.map.addSource(source,{type:'geojson',data});
    const municipality=kind==='municipalities';
    this.map.addLayer({id:`${source}-shadow`,type:'line',source,layout:{visibility:this.boundaryVisible[kind]?'visible':'none'},minzoom:municipality?3.4:0,paint:{'line-color':'#000000','line-width':municipality?['interpolate',['linear'],['zoom'],3.4,1,8,2.4,12,3]:['interpolate',['linear'],['zoom'],3,3.6,8,5],'line-opacity':municipality?.34:.45}});
    this.map.addLayer({id:source,type:'line',source,layout:{visibility:this.boundaryVisible[kind]?'visible':'none'},minzoom:municipality?3.4:0,paint:{'line-color':municipality?'#dbe6ef':'#ffffff','line-width':municipality?['interpolate',['linear'],['zoom'],3.4,.45,8,.8,12,1.25]:['interpolate',['linear'],['zoom'],3,1.35,8,2],'line-opacity':municipality?.82:.96}});
    const labelField=municipality?['coalesce',['get','name'],['get','NM_MUN'],['get','NM_MUNICIP'],['get','municipio']]:['coalesce',['get','name'],['get','NM_UF'],['get','sigla'],['get','uf']];
    this.map.addLayer({id:`${source}-labels`,type:'symbol',source,minzoom:municipality?6.5:3.8,layout:{visibility:this.boundaryVisible[kind]?'visible':'none','text-field':labelField,'text-size':municipality?['interpolate',['linear'],['zoom'],6.5,9,11,13]:['interpolate',['linear'],['zoom'],3.8,11,7,15],'text-font':['Open Sans Regular'],'text-allow-overlap':false,'text-ignore-placement':false},paint:{'text-color':'#ffffff','text-halo-color':'#111820','text-halo-width':1.6,'text-halo-blur':.1}});
    ['boundaries-states-shadow','boundaries-states','boundaries-states-labels','boundaries-municipalities-shadow','boundaries-municipalities','boundaries-municipalities-labels','radar-coverage','radar-coverage-line','radar-centers','lightning','storm-track-casing','storm-track-line','storm-track-ticks-casing','storm-track-ticks','storm-track-points','storm-track-origin','storm-track-origin-dot','storm-track-labels'].forEach(id=>{if(this.map.getLayer(id))this.map.moveLayer(id)});
  }
  drawBoundaryLayers(){for(const kind of ['states','municipalities'])if(this.boundaries[kind])this.drawBoundary(kind)}
  async restoreBoundaryLayers(){
    await Promise.all(['states','municipalities'].map(kind=>this.boundaryVisible[kind]?this.setBoundaries(kind,true):Promise.resolve()));
  }
  clearRadar(){this.radarTransition++;this.removeRadarIds([...new Set([...this.radarLayers,...this.radarPool,...this.pendingRadarLayers])]);this.radarLayers=[];this.radarPool.clear();this.pendingRadarLayers.clear();this.radarLayerOptions.clear()}
  removeRadarIds(ids){for(const id of ids.slice().reverse()){if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource(id))this.map.removeSource(id);this.v5PolarLayers.delete(id);this.radarLayerOptions.delete(id);this.pendingRadarLayers.delete(id);this.radarPool.delete(id)}}
  addRadar(layer,index=0,{track=true,opacity=this.opacity}={}){
    const id=layer.cacheKey?stableRadarId(layer.cacheKey):`radar-${layer.id}-${index}`;if(this.map.getLayer(id)&&(this.map.getSource(id)||this.v5PolarLayers.has(id))){if(track&&!this.radarLayers.includes(id))this.radarLayers.push(id);return id}
    if(this.radarScopeMode&&(this.radarScopeProfile==='scope5'||this.radarScopeProfile==='superres')&&layer.kind==='image'){
      const buildLayer=this.radarScopeProfile==='superres'?createSuperResPolarLayer:createV5PolarLayer;
      const custom=buildLayer({id,sourceLayer:layer,palette:paletteRgb(this.styleName)||SOURCE_REFLECTIVITY_COLORS.map(entry=>entry.rgb),classify:echoCode,dbzByCode:SOURCE_REFLECTIVITY_COLORS.map(entry=>entry.dbz),opacity});
      this.v5PolarLayers.set(id,custom);this.map.addLayer(custom);if(track)this.radarLayers.push(id);this.radarLayerOptions.set(id,{preserveColors:false,custom});
      ['boundaries-states-shadow','boundaries-states','boundaries-states-labels','boundaries-municipalities-shadow','boundaries-municipalities','boundaries-municipalities-labels','radar-coverage','radar-coverage-line','radar-centers','lightning','storm-track-casing','storm-track-line','storm-track-ticks-casing','storm-track-ticks','storm-track-points','storm-track-origin','storm-track-origin-dot','storm-track-labels'].forEach(layerId=>{if(this.map.getLayer(layerId))this.map.moveLayer(layerId)});
      return id;
    }
    let source;
    if(layer.kind==='image'){
      const layerOrigin=layer.radar&&Number.isFinite(Number(layer.radar.longitude))&&Number.isFinite(Number(layer.radar.latitude))
        ?[Number(layer.radar.longitude),Number(layer.radar.latitude)]
        :this.radarScopeOrigin;
      const imageOrigin=scopeImageOrigin(layer,layerOrigin);
      // O Brazil Scope sempre refaz a malha polar, inclusive sobre imagens
      // nativas em cache, pois esse modo precisa de gates mais densos.
      const transformScope=this.radarScopeMode&&(!layer.nativePixels||this.radarScopeProfile==='brazil');
      let radarUrl=transformScope?radarScopeUrl(layer.url,{origin:layerOrigin,imageOrigin,profile:this.radarScopeProfile,palette:this.styleName}):layer.url;
      if(!layer.preserveColors&&!transformScope&&!layer.skipPixelTransform)radarUrl=wxToolsUrl(radarUrl,this.styleName);
      source={type:'image',url:radarUrl,coordinates:layer.coordinates}
    }
    else{
      {
      const layerOrigin=layer.radar&&Number.isFinite(Number(layer.radar.longitude))&&Number.isFinite(Number(layer.radar.latitude))
        ?[Number(layer.radar.longitude),Number(layer.radar.latitude)]
        :this.radarScopeOrigin;
      const transformScope=this.radarScopeMode&&(!layer.nativePixels||this.radarScopeProfile==='brazil');
      let radarTiles=transformScope?layer.tiles.map(url=>radarScopeUrl(url,{origin:layerOrigin,profile:this.radarScopeProfile,palette:this.styleName})):layer.tiles;
      if(!layer.preserveColors&&!transformScope&&!layer.skipPixelTransform)radarTiles=radarTiles.map(url=>wxToolsUrl(url,this.styleName));
      source={type:'raster',tiles:radarTiles,tileSize:layer.tileSize||256};
      }
      if(Array.isArray(layer.bounds)&&layer.bounds.length===4)source.bounds=layer.bounds;
      if(Number.isFinite(layer.maxzoom))source.maxzoom=layer.maxzoom;
      if(layer.attribution)source.attribution=layer.attribution;
    }
    this.map.addSource(id,source);this.map.addLayer({id,type:'raster',source:id,layout:{visibility:'visible'},paint:stylePaint(layer.preserveColors?'normal':this.styleName,opacity)});if(track)this.radarLayers.push(id);this.radarLayerOptions.set(id,{preserveColors:Boolean(layer.preserveColors)});
    ['boundaries-states-shadow','boundaries-states','boundaries-states-labels','boundaries-municipalities-shadow','boundaries-municipalities','boundaries-municipalities-labels','radar-coverage','radar-coverage-line','radar-centers','lightning','storm-track-casing','storm-track-line','storm-track-ticks-casing','storm-track-ticks','storm-track-points','storm-track-origin','storm-track-origin-dot','storm-track-labels'].forEach(layerId=>{if(this.map.getLayer(layerId))this.map.moveLayer(layerId)});
    if(layer.id==='ipmet-live'&&layer.bounds&&!layer.keepView)this.fitBounds(layer.bounds);
    return id;
  }
  async replaceRadar(layers,duration=90,{timeout=3500,requireLoaded=false,retain=false}={}){
    const transition=++this.radarTransition;const previous=this.radarLayers.slice();const next=[];
    layers.forEach((layer,index)=>{const id=this.addRadar(layer,`${transition}-${index}`,{track:false,opacity:0});if(id){next.push(id);if(this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility','visible');this.pendingRadarLayers.add(id);if(retain)this.radarPool.add(id)}});
    if(!next.length){this.clearRadar();return}
    const loaded=await this.waitForRadarSources(next,timeout);
    if(requireLoaded&&!loaded){this.removeRadarIds(next);throw new Error('Um quadro do radar não terminou de carregar. Tente gerar o GIF novamente.');}
    if(transition!==this.radarTransition){this.removeRadarIds(next);return}
    this.radarLayers=next;next.forEach(id=>this.pendingRadarLayers.delete(id));
    for(const id of [...previous,...next])if(this.map.getLayer(id)&&!this.v5PolarLayers.has(id))this.map.setPaintProperty(id,'raster-opacity-transition',{duration,delay:0});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(transition!==this.radarTransition)return;
    previous.filter(id=>!next.includes(id)).forEach(id=>{const custom=this.v5PolarLayers.get(id);if(custom)custom.setOpacity(0);else if(this.map.getLayer(id))this.map.setPaintProperty(id,'raster-opacity',0)});
    next.forEach(id=>{const custom=this.v5PolarLayers.get(id);if(custom)custom.setOpacity(this.opacity);else if(this.map.getLayer(id))this.map.setPaintProperty(id,'raster-opacity',this.opacity)});
    await new Promise(resolve=>setTimeout(resolve,duration+35));
    if(transition===this.radarTransition){const replaced=previous.filter(id=>!next.includes(id));if(retain)replaced.forEach(id=>{if(this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility','none')});else this.removeRadarIds(replaced)}
  }
  async preloadRadarLayers(layers,timeout=12000){
    const ids=[];layers.forEach((layer,index)=>{if(!layer?.cacheKey)return;const id=this.addRadar(layer,`preload-${index}`,{track:false,opacity:0});if(id){ids.push(id);this.radarPool.add(id);if(this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility','visible')}});if(!ids.length)return true;
    const loaded=await this.waitForRadarSources(ids,timeout),current=new Set(this.radarLayers);ids.forEach(id=>{if(!current.has(id)&&this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility','none')});return loaded;
  }
  waitForRadarSources(ids,timeout=3500){return new Promise(resolve=>{let done=false;const finish=loaded=>{if(done)return;done=true;clearTimeout(timer);this.map.off('sourcedata',check);resolve(loaded)};const check=()=>{if(ids.some(id=>!this.map.getLayer(id)||this.v5PolarLayers.get(id)?.failed))return finish(false);if(ids.every(id=>{const custom=this.v5PolarLayers.get(id);if(custom)return custom.ready;try{return this.map.isSourceLoaded(id)}catch{return false}}))finish(true)};const timer=setTimeout(()=>finish(false),timeout);this.map.on('sourcedata',check);ids.forEach(id=>this.v5PolarLayers.get(id)?.readyPromise.then(check));check()})}
  setRadarStyle(name,opacity=this.opacity){this.styleName=name;this.opacity=opacity;for(const id of this.radarLayers){if(!this.map.getLayer(id))continue;const custom=this.v5PolarLayers.get(id);if(custom){custom.setPalette(paletteRgb(name)||SOURCE_REFLECTIVITY_COLORS.map(entry=>entry.rgb));custom.setOpacity(opacity);continue}const paint=stylePaint(this.radarLayerOptions.get(id)?.preserveColors?'normal':name,opacity);Object.entries(paint).forEach(([key,value])=>this.map.setPaintProperty(id,key,value))}}
  setRadarScopeMode(enabled,origin=this.radarScopeOrigin,profile='scope'){this.radarScopeMode=Boolean(enabled);this.radarScopeProfile=['super','scope2hd','scope4','scope5','superres','brazil','brazil2','hub'].includes(profile)?profile:'scope';this.setRadarScopeOrigin(origin)}
  setRadarScopeOrigin(origin){if(Array.isArray(origin)&&origin.length===2&&origin.every(Number.isFinite))this.radarScopeOrigin=origin.slice()}
  getCenter(){const center=this.map.getCenter();return [center.lng,center.lat]}
  getBounds(){const bounds=this.map.getBounds();return {west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()}}
  visibleTileUrls(layer,padding=0){
    if(layer?.kind!=='tiles'||!layer.tiles?.length)return [];
    const template=layer.tiles[0],zoom=Math.max(0,Math.min(Number.isFinite(layer.maxzoom)?layer.maxzoom:18,Math.floor(this.map.getZoom()))),world=2**zoom,bounds=this.getBounds();
    const tileX=longitude=>Math.floor((Math.max(-180,Math.min(180,longitude))+180)/360*world);
    const tileY=latitude=>{const lat=Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180;return Math.floor((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*world)};
    const minX=Math.max(0,tileX(bounds.west)-padding),maxX=Math.min(world-1,tileX(bounds.east)+padding),minY=Math.max(0,tileY(bounds.north)-padding),maxY=Math.min(world-1,tileY(bounds.south)+padding),urls=[];
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)urls.push(template.replaceAll('{z}',String(zoom)).replaceAll('{x}',String(x)).replaceAll('{y}',String(y)));
    return urls.filter(url=>!url.includes('{'));
  }
  setOpacity(value){this.setRadarStyle(this.styleName,value)}
  setCoverage(radars,visible=true){
    this.removeLayerAndSource('radar-coverage-line');this.removeLayerAndSource('radar-coverage');
    const valid=radars.filter(r=>Number.isFinite(r.longitude)&&Number.isFinite(r.latitude));const polygons=valid.flatMap(r=>[circleFeature([r.longitude,r.latitude],r.rangeKm||250,{name:r.name,range:r.rangeKm||250}),...(r.surveillanceKm?[circleFeature([r.longitude,r.latitude],r.surveillanceKm,{name:r.name,range:r.surveillanceKm,outer:true})]:[])]);
    const isOuter=['boolean',['get','outer'],false];this.map.addSource('radar-coverage',{type:'geojson',data:{type:'FeatureCollection',features:polygons}});this.map.addLayer({id:'radar-coverage',type:'fill',source:'radar-coverage',layout:{visibility:visible?'visible':'none'},paint:{'fill-color':['case',isOuter,'#e87924','#087f9b'],'fill-opacity':['case',isOuter,.025,.055]}});this.map.addLayer({id:'radar-coverage-line',type:'line',source:'radar-coverage',layout:{visibility:visible?'visible':'none'},paint:{'line-color':['case',isOuter,'#d86615','#007f9e'],'line-width':['case',isOuter,1,1.6],'line-opacity':['case',isOuter,.7,.9]}});if(this.map.getLayer('radar-centers'))this.map.moveLayer('radar-centers');
  }
  setRadarMarkers(radars){
    this.radarCatalog=(radars||[]).filter(r=>Number.isFinite(Number(r.longitude))&&Number.isFinite(Number(r.latitude)));
    this.removeLayerAndSource('radar-centers');if(!this.map.isStyleLoaded()||!this.radarCatalog.length)return;
    const features=this.radarCatalog.map(r=>({type:'Feature',properties:{id:String(r.id||''),sourceId:String(r.sourceId||''),name:String(r.name||'Radar'),available:r.available!==false},geometry:{type:'Point',coordinates:[Number(r.longitude),Number(r.latitude)]}}));
    this.map.addSource('radar-centers',{type:'geojson',data:{type:'FeatureCollection',features}});this.map.addLayer({id:'radar-centers',type:'circle',source:'radar-centers',layout:{visibility:this.radarMarkersVisible===false?'none':'visible'},paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,5.5,8,8.5],'circle-color':'#e11919','circle-stroke-color':'#ffffff','circle-stroke-width':2.2,'circle-opacity':.96}})
  }
  setRadarPicker(handler){this.radarPicker=typeof handler==='function'?handler:null}
  setLightning(data,visible=true){
    this.removeLayerAndSource('lightning');
    const features=Array.isArray(data)?data:[];this.map.addSource('lightning',{type:'geojson',data:{type:'FeatureCollection',features}});this.map.addLayer({id:'lightning',type:'circle',source:'lightning',layout:{visibility:visible?'visible':'none'},paint:{'circle-radius':['case',['<',['get','ageMinutes'],5],3.2,2.7],'circle-color':['case',['<',['get','ageMinutes'],5],'#ff3232',['<',['get','ageMinutes'],10],'#ffd43b','#35d66f'],'circle-opacity':.96,'circle-stroke-color':'#111111','circle-stroke-width':.65}})
  }
  setStormTrackPicker(enabled,handler){this.stormTrackPicker=enabled?handler:null;this.map.getCanvas().style.cursor=enabled?'crosshair':''}
  setStormTrack(origin,bearingDeg,speedKt,details={}){
    this.setStormTracks([{origin,bearingDeg,speedKt,details}]);
  }
  setStormTracks(tracks=[]){
    const minutes=[0,10,20,30,40,50,60],features=[];
    tracks.forEach((track,trackIndex)=>{const speedKmh=Math.max(0,Number(track.speedKt)||0)*1.852,coordinates=minutes.map(minute=>destinationPoint(track.origin,Number(track.bearingDeg)||0,speedKmh*minute/60)),properties={track:trackIndex,activity:track.details?.activity||0};features.push({type:'Feature',properties:{...properties,kind:'path'},geometry:{type:'LineString',coordinates}});coordinates.forEach((coordinate,index)=>{const minute=minutes[index];features.push({type:'Feature',properties:{...properties,kind:index===0?'origin':'point',minute,label:minute===0?'Agora':`+${minute} min`},geometry:{type:'Point',coordinates}});if(index>0){const tickLength=Math.max(.8,Math.min(2.5,speedKmh/80)),left=destinationPoint(coordinate,(Number(track.bearingDeg)||0)+90,tickLength),right=destinationPoint(coordinate,(Number(track.bearingDeg)||0)-90,tickLength);features.push({type:'Feature',properties:{...properties,kind:'tick',minute},geometry:{type:'LineString',coordinates:[left,right]}})}})});
    this.stormTrackData={type:'FeatureCollection',features,details:{automatic:true,count:tracks.length}};this.drawStormTrack();
  }
  drawStormTrack(){
    if(!this.stormTrackData||!this.map.isStyleLoaded())return;
    if(this.map.getSource('storm-track')){this.map.getSource('storm-track').setData(this.stormTrackData);return}
    this.map.addSource('storm-track',{type:'geojson',data:this.stormTrackData});
    const pathFilter=['==',['get','kind'],'path'],pointFilter=['==',['get','kind'],'point'],originFilter=['==',['get','kind'],'origin'],tickFilter=['==',['get','kind'],'tick'];
    this.map.addLayer({id:'storm-track-casing',type:'line',source:'storm-track',filter:pathFilter,paint:{'line-color':'#080808','line-width':['interpolate',['linear'],['zoom'],3,4,9,8],'line-opacity':.95}});
    this.map.addLayer({id:'storm-track-line',type:'line',source:'storm-track',filter:pathFilter,paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],3,1.8,9,3.5],'line-opacity':1}});
    this.map.addLayer({id:'storm-track-ticks-casing',type:'line',source:'storm-track',filter:tickFilter,paint:{'line-color':'#080808','line-width':['interpolate',['linear'],['zoom'],3,4,9,7],'line-opacity':.95}});
    this.map.addLayer({id:'storm-track-ticks',type:'line',source:'storm-track',filter:tickFilter,paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],3,1.5,9,3],'line-opacity':1}});
    this.map.addLayer({id:'storm-track-points',type:'circle',source:'storm-track',filter:pointFilter,paint:{'circle-radius':['+',3,['/', ['get','minute'],30]],'circle-color':'#fff','circle-stroke-color':'#111','circle-stroke-width':2}});
    this.map.addLayer({id:'storm-track-origin',type:'circle',source:'storm-track',filter:originFilter,paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,6,9,10],'circle-color':'#fff','circle-stroke-color':'#111','circle-stroke-width':3}});
    this.map.addLayer({id:'storm-track-origin-dot',type:'circle',source:'storm-track',filter:originFilter,paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,2,9,3.5],'circle-color':'#111'}});
    this.map.addLayer({id:'storm-track-labels',type:'symbol',source:'storm-track',filter:pointFilter,layout:{'text-field':['get','label'],'text-size':['interpolate',['linear'],['zoom'],3,10,9,14],'text-offset':[0,-1.25],'text-anchor':'bottom','text-allow-overlap':true},paint:{'text-color':'#ffffff','text-halo-color':'#111111','text-halo-width':2,'text-halo-blur':.2}});
  }
  clearStormTrack(){for(const id of ['storm-track-labels','storm-track-origin-dot','storm-track-origin','storm-track-points','storm-track-ticks','storm-track-ticks-casing','storm-track-line','storm-track-casing'])if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource('storm-track'))this.map.removeSource('storm-track');this.stormTrackData=null}
  setLayerVisibility(id,visible){if(id==='radar-centers')this.radarMarkersVisible=Boolean(visible);if(this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility',visible?'visible':'none')}
  removeLayerAndSource(id){if(this.map.getLayer(id))this.map.removeLayer(id);if(this.map.getSource(id))this.map.removeSource(id)}
  view3d(enabled){this.map.easeTo({pitch:enabled?55:0,bearing:enabled?-18:0,duration:700})}
  topDown(){this.map.easeTo({pitch:0,bearing:0,duration:600})}
  home(){this.map.flyTo({center:CONFIG.center,zoom:3.6,pitch:0,bearing:0,duration:900})}
  fitBounds(bounds){const mobile=matchMedia('(max-width: 760px)').matches;this.map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:{top:70,right:45,bottom:100,left:mobile?235:325},duration:900,maxZoom:7})}
  flyTo(radar){const requested=Number(radar?.zoom);const zoom=Number.isFinite(requested)?Math.max(4,Math.min(11,requested)):7.4;this.map.flyTo({center:[radar.longitude,radar.latitude],zoom,pitch:this.map.getPitch(),bearing:0,duration:800})}
  setDisplayQuality(quality='extreme'){
    const memory=Number(globalThis.navigator?.deviceMemory||4);
    const container=this.map.getContainer();
    const area=Math.max(1,container.clientWidth*container.clientHeight);
    const desired=({balanced:1,high:1.5,ultra:2,extreme:2,supreme4k:3})[quality]||2;
    const budget=memory<=2?3e6:memory<=4?6e6:9e6;
    const ratio=Math.max(1,Math.min(Math.max(globalThis.devicePixelRatio||1,desired),Math.sqrt(budget/area),3));
    this.displayQuality=quality;
    if(Math.abs(this.map.getPixelRatio()-ratio)>.01)this.map.setPixelRatio(ratio);
  }
  resize(){this.setDisplayQuality(this.displayQuality);this.map.resize()}
  async useExportResolution(pixelRatio=2){
    const previous=this.map.getPixelRatio();
    const target=Math.min(4,Math.max(previous,Number(pixelRatio)||previous));
    if(target<=previous+.01)return async()=>{};
    this.map.setPixelRatio(target);this.map.resize();
    await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve()};const timer=setTimeout(finish,1800);this.map.once('render',finish);this.map.triggerRepaint()});
    return async()=>{this.map.setPixelRatio(previous);this.map.resize();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))};
  }
  captureFrame(maxWidth=720,maxHeight=Number.POSITIVE_INFINITY){
    return new Promise((resolve,reject)=>{
      let finished=false,timer=null;
      const cleanup=()=>{if(timer)clearTimeout(timer);this.map.off('render',capture)};
      const capture=()=>{
        if(finished)return;finished=true;cleanup();
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          try{
            const source=this.map.getCanvas();
            const scale=Math.min(1,maxWidth/source.width,maxHeight/source.height);
            const width=Math.max(1,Math.round(source.width*scale));
            const height=Math.max(1,Math.round(source.height*scale));
            const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
            const context=canvas.getContext('2d',{willReadFrequently:true});
            if(!context)throw new Error('O navegador não permitiu capturar o mapa.');
            context.imageSmoothingEnabled=!(this.styleName.startsWith('wx_')||this.radarScopeMode);if(context.imageSmoothingEnabled)context.imageSmoothingQuality='high';
            context.drawImage(source,0,0,width,height);
            resolve({width,height,data:context.getImageData(0,0,width,height).data});
          }catch(error){reject(error)}
        }));
      };
      this.map.once('render',capture);this.map.triggerRepaint();
      timer=setTimeout(()=>{if(finished)return;cleanup();finished=true;reject(new Error('O mapa demorou demais para preparar a captura.'))},8000);
    });
  }
  downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  async downloadPng(filename,{pixelRatio=2,maxWidth=2560,maxHeight=1600}={}){
    const restoreResolution=await this.useExportResolution(pixelRatio);
    try{
      const frame=await this.captureFrame(maxWidth,maxHeight);
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      const context=canvas.getContext('2d');context.putImageData(new ImageData(frame.data,frame.width,frame.height),0,0);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Não foi possível gerar a imagem do radar.')),'image/png'));
      this.downloadBlob(blob,filename);
      return {width:frame.width,height:frame.height,size:blob.size};
    }finally{await restoreResolution()}
  }
}
