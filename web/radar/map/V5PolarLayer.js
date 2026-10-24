import {calibrateRadarProfile,resolveRadarProfile} from './RadarProfiles.js?v=20260914-v5-clean25';

// V5 renders one physical polar cell for every sampled ray/range gate.
// Providers may supply native geometry; these values are documented fallbacks.
export const V5_AZIMUTH_COUNT=720;
export const V5_AZIMUTH_WIDTH=360/V5_AZIMUTH_COUNT;
export const V5_GATE_DEPTH_METERS=250;
export const V5_TARGET_GATE_COUNT=1_000_000;
const EARTH_RADIUS_KM=6371.0088;
const NO_ECHO=255;
export const RADAR_POLAR_DEBUG=false;
const RANGE_SEAM_OVERLAP_METERS=.4;
const AZIMUTH_SEAM_OVERLAP_DEGREES=.00008;

export function destinationPoint(radarLat,radarLon,distanceMeters,bearingDegrees){
  const distance=distanceMeters/1000/EARTH_RADIUS_KM;
  const bearing=bearingDegrees*Math.PI/180;
  const lat1=radarLat*Math.PI/180,lon1=radarLon*Math.PI/180;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(distance)+Math.cos(lat1)*Math.sin(distance)*Math.cos(bearing));
  const lon2=lon1+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(lat1),Math.cos(distance)-Math.sin(lat1)*Math.sin(lat2));
  return [((lon2*180/Math.PI+540)%360)-180,lat2*180/Math.PI];
}

export function createRadarGate(radarLat,radarLon,azimuth,azimuthWidth,range,gateDepth,value){
  const a0=azimuth-azimuthWidth/2,a1=azimuth+azimuthWidth/2;
  const r0=range,r1=range+gateDepth;
  // A sub-metre overlap prevents projection cracks. Metadata keeps the exact
  // physical bin dimensions; only the rendered corners receive the overlap.
  const drawA0=a0-AZIMUTH_SEAM_OVERLAP_DEGREES,drawA1=a1+AZIMUTH_SEAM_OVERLAP_DEGREES;
  const drawR0=Math.max(0,r0-RANGE_SEAM_OVERLAP_METERS/2),drawR1=r1+RANGE_SEAM_OVERLAP_METERS/2;
  const p1=destinationPoint(radarLat,radarLon,drawR0,drawA0);
  const p2=destinationPoint(radarLat,radarLon,drawR1,drawA0);
  const p3=destinationPoint(radarLat,radarLon,drawR1,drawA1);
  const p4=destinationPoint(radarLat,radarLon,drawR0,drawA1);
  return {coordinates:[p1,p2,p3,p4,p1],value,r0,r1,a0,a1};
}

export function validateRadarGate(gate,radarLat,radarLon,toleranceDegrees=1e-3){
  const points=gate.coordinates.slice(0,4),center=[points.reduce((sum,p)=>sum+p[0],0)/4,points.reduce((sum,p)=>sum+p[1],0)/4];
  const lat1=radarLat*Math.PI/180,lat2=center[1]*Math.PI/180,dLon=(center[0]-radarLon)*Math.PI/180;
  const bearing=(Math.atan2(Math.sin(dLon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon))*180/Math.PI+360)%360;
  const expected=((gate.a0+gate.a1)/2+360)%360,error=Math.abs(((bearing-expected+540)%360)-180);
  return {ok:error<=toleranceDegrees,error,bearing,expected};
}

export function createV5SyntheticGateMesh({radarLat=0,radarLon=0,azimuths=V5_AZIMUTH_COUNT,gates=100,gateDepth=V5_GATE_DEPTH_METERS}={}){
  const mesh=[];
  for(let azimuthIndex=0;azimuthIndex<azimuths;azimuthIndex++){
    const width=360/azimuths,azimuth=azimuthIndex*width;
    for(let rangeIndex=0;rangeIndex<gates;rangeIndex++)mesh.push(createRadarGate(radarLat,radarLon,azimuth,width,rangeIndex*gateDepth,gateDepth,(azimuthIndex+rangeIndex)%2));
  }
  return mesh;
}

function compileShader(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`V5 shader: ${error}`)}
  return shader;
}

function createProgram(gl){
  const vertex=compileShader(gl,gl.VERTEX_SHADER,`#version 300 es
    uniform mat4 u_matrix;
    in vec2 a_pos;
    void main(){gl_Position=u_matrix*vec4(a_pos,0.0,1.0);}`);
  const fragment=compileShader(gl,gl.FRAGMENT_SHADER,`#version 300 es
    precision mediump float;
    uniform vec4 u_color;
    out vec4 fragColor;
    void main(){fragColor=u_color;}`);
  const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error(`V5 program: ${error}`)}
  return program;
}

function haversineKm(a,b){
  const lat1=a[1]*Math.PI/180,lat2=b[1]*Math.PI/180,dLat=lat2-lat1,dLon=(b[0]-a[0])*Math.PI/180;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_KM*Math.asin(Math.min(1,Math.sqrt(h)));
}

function layerRangeKm(sourceLayer,origin){
  const explicit=Number(sourceLayer.radar?.rangeKm);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const c=sourceLayer.coordinates;
  if(!Array.isArray(c)||c.length<4)return 250;
  const west=Number(c[0][0]),east=Number(c[1][0]),north=Number(c[0][1]),south=Number(c[2][1]);
  const candidates=[haversineKm(origin,[west,origin[1]]),haversineKm(origin,[east,origin[1]]),haversineKm(origin,[origin[0],north]),haversineKm(origin,[origin[0],south])].filter(value=>Number.isFinite(value)&&value>0);
  return candidates.length?Math.min(...candidates):250;
}

function mercatorY(latitude){
  const sin=Math.sin(Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180);
  return .5-Math.log((1+sin)/(1-sin))/(4*Math.PI);
}

function imagePixel(coordinate,coordinates,width,height){
  const west=Number(coordinates[0][0]),east=Number(coordinates[1][0]),north=Number(coordinates[0][1]),south=Number(coordinates[2][1]);
  const northY=mercatorY(north),southY=mercatorY(south);
  return [(coordinate[0]-west)/(east-west)*(width-1),(mercatorY(coordinate[1])-northY)/(southY-northY)*(height-1)];
}

async function decodeImage(url,signal){
  const response=await fetch(url,{signal});if(!response.ok)throw new Error(`V5 radar HTTP ${response.status}`);
  const bitmap=await createImageBitmap(await response.blob());
  const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(bitmap.width,bitmap.height):Object.assign(document.createElement('canvas'),{width:bitmap.width,height:bitmap.height});
  const context=canvas.getContext('2d',{alpha:true,willReadFrequently:true});context.imageSmoothingEnabled=false;context.clearRect(0,0,bitmap.width,bitmap.height);context.drawImage(bitmap,0,0);bitmap.close?.();
  return context.getImageData(0,0,canvas.width,canvas.height);
}

function rgba(color,opacity){return [(color?.[0]??255)/255,(color?.[1]??255)/255,(color?.[2]??255)/255,opacity]}

function median(values){
  if(!values.length)return 0;
  const sorted=values.slice().sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function angularDifference(next,current){return ((next-current+540)%360)-180}
function forwardAngularDifference(next,current){return ((next-current)%360+360)%360}
export function resolveAzimuthGeometry(sourceLayer={}){
  const polar=sourceLayer.polar||sourceLayer.radar?.polar||{};
  const supplied=(polar.azimuths||sourceLayer.azimuths||[]).map(Number).filter(Number.isFinite);
  const deltas=[];
  if(supplied.length>1)for(let index=0;index<supplied.length-1;index++){
    const delta=forwardAngularDifference(supplied[index+1],supplied[index]);
    if(delta>0&&delta<10)deltas.push(delta);
  }
  if(supplied.length>2){
    const closingDelta=forwardAngularDifference(supplied[0],supplied[supplied.length-1]);
    if(closingDelta>0&&closingDelta<10)deltas.push(closingDelta);
  }
  const explicit=Number(polar.azimuthResolutionDegrees??polar.raySpacingDegrees??sourceLayer.azimuthResolutionDegrees??sourceLayer.radar?.azimuthResolutionDegrees);
  const spacing=deltas.length?median(deltas):(Number.isFinite(explicit)&&explicit>0?explicit:V5_AZIMUTH_WIDTH);
  const start=Number(polar.sweepStartAngleDeg??0)+Number(polar.azimuthOffsetDeg??0);
  const azimuths=supplied.length?supplied:Array.from({length:Math.max(1,Math.round(360/spacing))},(_,index)=>(start+index*spacing+360)%360);
  const explicitBeam=Number(polar.beamWidthDegrees??sourceLayer.beamWidthDegrees??sourceLayer.radar?.beamWidthDegrees);
  const validDelta=value=>Number.isFinite(value)&&value>0&&value<10;
  const beamWidths=azimuths.map((azimuth,index)=>{
    if(!supplied.length)return Math.min(spacing,Number.isFinite(explicitBeam)&&explicitBeam>0?explicitBeam:spacing);
    const previous=index>0?forwardAngularDifference(azimuth,azimuths[index-1]):forwardAngularDifference(azimuth,azimuths[azimuths.length-1]);
    const next=index<azimuths.length-1?forwardAngularDifference(azimuths[index+1],azimuth):forwardAngularDifference(azimuths[0],azimuth);
    const neighbors=[previous,next].filter(validDelta);
    const localSpacing=neighbors.length?neighbors.reduce((sum,value)=>sum+value,0)/neighbors.length:spacing;
    return Math.min(localSpacing,Number.isFinite(explicitBeam)&&explicitBeam>0?explicitBeam:localSpacing);
  });
  return {azimuths,beamWidths,beamWidth:median(beamWidths),medianSpacing:spacing,minSpacing:deltas.length?Math.min(...deltas):spacing,maxSpacing:deltas.length?Math.max(...deltas):spacing,source:supplied.length?'native azimuths':Number.isFinite(explicit)&&explicit>0?'provider metadata':'fallback 0.5 deg'};
}
function bearingTo(origin,point){
  const lat1=origin[1]*Math.PI/180,lat2=point[1]*Math.PI/180,delta=(point[0]-origin[0])*Math.PI/180;
  return (Math.atan2(Math.sin(delta)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(delta))*180/Math.PI+360)%360;
}
export function resolveRangeGeometry(image,maxRangeMeters,sourceLayer={},rayCount=V5_AZIMUTH_COUNT){
  const polar=sourceLayer.polar||sourceLayer.radar?.polar||{};
  const explicit=Number(polar.rangeResolutionMeters??polar.gateSizeMeters??sourceLayer.rangeResolutionMeters??sourceLayer.radar?.rangeResolutionMeters);
  if(Number.isFinite(explicit)&&explicit>0)return {resolution:explicit,source:'provider metadata'};
  if(Number.isFinite(maxRangeMeters)&&maxRangeMeters>0&&Number.isFinite(rayCount)&&rayCount>0){
    const gateCount=Math.max(1,Math.ceil(V5_TARGET_GATE_COUNT/rayCount));
    return {resolution:maxRangeMeters/gateCount,gateCount,source:`V5 target ${V5_TARGET_GATE_COUNT.toLocaleString('en-US')} cells`};
  }
  const samples=Math.min(Number(image?.width),Number(image?.height));
  if(Number.isFinite(samples)&&samples>0&&Number.isFinite(maxRangeMeters)&&maxRangeMeters>0){
    const measured=2*maxRangeMeters/samples;
    if(Number.isFinite(measured)&&measured>=50&&measured<=5000)return {resolution:measured,source:`image-derived (${image.width}x${image.height})`};
  }
  return {resolution:V5_GATE_DEPTH_METERS,source:'fallback 250 m'};
}
export function sourceGateDepthMeters(image,maxRangeMeters,sourceLayer={},rayCount=V5_AZIMUTH_COUNT){return resolveRangeGeometry(image,maxRangeMeters,sourceLayer,rayCount).resolution}

function createDebugPanel(map,stats){
  map.getContainer().querySelectorAll('[data-v5-polar-debug="true"]').forEach(element=>element.remove());
  const panel=document.createElement('aside');
  panel.dataset.v5PolarDebug='true';
  panel.style.cssText='position:absolute;right:12px;bottom:82px;z-index:8;max-width:350px;padding:10px;background:rgba(4,10,18,.9);color:white;font:12px/1.45 monospace;white-space:pre-line;pointer-events:none';
  panel.textContent=Object.entries(stats).map(([key,value])=>key+': '+value).join('\n');
  map.getContainer().appendChild(panel);return panel;
}
export function createV5PolarLayer({id,sourceLayer,palette,classify,dbzByCode=[],opacity=1}){
  const debug=RADAR_POLAR_DEBUG;
  let resolveReady;const readyPromise=new Promise(resolve=>{resolveReady=resolve});
  const custom={
    id,type:'custom',renderingMode:'2d',ready:false,failed:false,opacity,palette,groups:[],debugBuffers:[],readyPromise,
    onAdd(map,gl){
      this.map=map;this.gl=gl;this.abortController=new AbortController();
      try{this.program=createProgram(gl);this.aPos=gl.getAttribLocation(this.program,'a_pos');this.uMatrix=gl.getUniformLocation(this.program,'u_matrix');this.uColor=gl.getUniformLocation(this.program,'u_color')}
      catch(error){this.failed=true;resolveReady(false);console.error(error);return}
      void this.prepare().catch(error=>{if(error?.name!=='AbortError')console.error('BrasilScope V5:',error);this.failed=true;resolveReady(false)});
    },
    async prepare(){
      const image=await decodeImage(sourceLayer.url,this.abortController.signal);
      let profile=resolveRadarProfile(sourceLayer);
      const radarLat=Number(profile.latitude??sourceLayer.radar?.latitude),radarLon=Number(profile.longitude??sourceLayer.radar?.longitude);
      if(!Number.isFinite(radarLat)||!Number.isFinite(radarLon)||!Array.isArray(sourceLayer.coordinates))throw new Error('Radar sem origem geográfica exata.');
      const maxRangeMeters=layerRangeKm(sourceLayer,[radarLon,radarLat])*1000;
      profile=calibrateRadarProfile(profile,image,maxRangeMeters,sourceLayer);
      const profilePolar={azimuthResolutionDegrees:360/profile.azimuthCount,beamWidthDegrees:profile.beamWidthDeg,sweepStartAngleDeg:profile.sweepStartAngleDeg,azimuthOffsetDeg:profile.azimuthOffsetDeg};
      if(Number.isFinite(profile.gateSpacingMeters)&&profile.gateSpacingMeters>0)profilePolar.rangeResolutionMeters=profile.gateSpacingMeters;
      const effectiveLayer={...sourceLayer,radar:{...profile,...sourceLayer.radar,latitude:radarLat,longitude:radarLon},polar:{...profilePolar,...(sourceLayer.polar||{})}};
      const angular=resolveAzimuthGeometry(effectiveLayer),rayCount=angular.azimuths.length,firstGateMeters=Math.max(0,Number(profile.firstGateMeters)||0);
      const usableRangeMeters=Math.max(1,maxRangeMeters-firstGateMeters),radial=resolveRangeGeometry(image,usableRangeMeters,effectiveLayer,rayCount),gateDepthMeters=radial.resolution;
      const gateCount=Math.min(Number(profile.maxGates)||Infinity,radial.gateCount||Math.max(1,Math.ceil(usableRangeMeters/gateDepthMeters))),total=rayCount*gateCount;
      const codes=new Uint8Array(total);codes.fill(NO_ECHO);
      const counts=new Uint32Array(16);
      for(let rayIndex=0;rayIndex<rayCount;rayIndex++){
        const azimuth=angular.azimuths[rayIndex];
        for(let gateIndex=0;gateIndex<gateCount;gateIndex++){
          const center=destinationPoint(radarLat,radarLon,firstGateMeters+(gateIndex+.5)*gateDepthMeters,azimuth);
          const [x,y]=imagePixel(center,sourceLayer.coordinates,image.width,image.height),px=Math.round(x),py=Math.round(y);
          if(px<0||px>=image.width||py<0||py>=image.height)continue;
          const code=classify(image.data,(py*image.width+px)*4);
          if(!Number.isInteger(code)||code<0||code>=counts.length||code===NO_ECHO)continue;
          codes[rayIndex*gateCount+gateIndex]=code;counts[code]++;
        }
        if((rayIndex&31)===31){if(this.abortController.signal.aborted)return;await new Promise(resolve=>setTimeout(resolve,0))}
      }
      const positions=Array.from(counts,count=>new Float32Array(count*12)),offsets=new Uint32Array(counts.length);
      for(let rayIndex=0;rayIndex<rayCount;rayIndex++){
        const azimuth=angular.azimuths[rayIndex],beamWidth=angular.beamWidths[rayIndex];
        for(let gateIndex=0;gateIndex<gateCount;gateIndex++){
          const code=codes[rayIndex*gateCount+gateIndex];if(code===NO_ECHO)continue;
          const gate=createRadarGate(radarLat,radarLon,azimuth,beamWidth,firstGateMeters+gateIndex*gateDepthMeters,gateDepthMeters,code);
          const corners=gate.coordinates.slice(0,4).map(point=>maplibregl.MercatorCoordinate.fromLngLat(point));
          const target=positions[code],offset=offsets[code];
          target.set([corners[0].x,corners[0].y,corners[1].x,corners[1].y,corners[2].x,corners[2].y,corners[0].x,corners[0].y,corners[2].x,corners[2].y,corners[3].x,corners[3].y],offset);
          offsets[code]+=12;
        }
        if((rayIndex&31)===31){if(this.abortController.signal.aborted)return;await new Promise(resolve=>setTimeout(resolve,0))}
      }
      if(this.abortController.signal.aborted)return;
      this.groups=[];
      for(let code=0;code<positions.length;code++)if(positions[code].length){
        const buffer=this.gl.createBuffer();this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,positions[code],this.gl.STATIC_DRAW);
        this.groups.push({code,buffer,vertices:positions[code].length/2});
      }
      const tangential=range=>Math.round(range*angular.beamWidth*Math.PI/180);
      const renderedGates=counts.reduce((sum,count)=>sum+count,0);
      this.stats={
        radarId:sourceLayer.radar?.id||sourceLayer.id||id,profileId:profile.id,calibration:profile.calibration,firstGate:firstGateMeters.toFixed(0)+' m',
        geometrySource:angular.source,
        totalRays:rayCount,totalGates:total,renderedGates,
        medianAzimuthSpacing:angular.medianSpacing.toFixed(4)+'°',
        minAzimuthSpacing:angular.minSpacing.toFixed(4)+'°',
        maxAzimuthSpacing:angular.maxSpacing.toFixed(4)+'°',
        renderedBeamWidth:angular.beamWidth.toFixed(4)+'°',
        rangeResolution:gateDepthMeters.toFixed(1)+' m',rangeResolutionSource:radial.source,maxRange:Math.round(maxRangeMeters/1000)+' km',
        gate10km:gateDepthMeters.toFixed(1)+' m radial × '+tangential(10000)+' m tangential',
        gate50km:gateDepthMeters.toFixed(1)+' m radial × '+tangential(50000)+' m tangential',
        gate100km:gateDepthMeters.toFixed(1)+' m radial × '+tangential(100000)+' m tangential',
        gate200km:gateDepthMeters.toFixed(1)+' m radial × '+tangential(200000)+' m tangential'
      };
      if(debug){
        console.info('V5 physical polar gates',this.stats);
        this.debugPanel=createDebugPanel(this.map,this.stats);
        this.debugPanel.style.display=this.opacity>0?'block':'none';
        const summary=this.debugPanel.textContent,origin=[radarLon,radarLat];
        this.debugClick=event=>{
          if(!this.ready||this.opacity<=0)return;
          const point=[event.lngLat.lng,event.lngLat.lat],azimuth=bearingTo(origin,point),range=haversineKm(origin,point)*1000;
          let rayIndex=0,bestDelta=Infinity;
          for(let index=0;index<rayCount;index++){const delta=Math.abs(angularDifference(azimuth,angular.azimuths[index]));if(delta<bestDelta){bestDelta=delta;rayIndex=index}}
          const beamWidth=angular.beamWidths[rayIndex],gateIndex=Math.floor((range-firstGateMeters)/gateDepthMeters),code=gateIndex>=0&&gateIndex<gateCount&&bestDelta<=beamWidth/2?codes[rayIndex*gateCount+gateIndex]:NO_ECHO;
          if(code===NO_ECHO){this.debugPanel.textContent=summary+'\n\nSem eco neste gate';return}
          const gate=createRadarGate(radarLat,radarLon,angular.azimuths[rayIndex],beamWidth,firstGateMeters+gateIndex*gateDepthMeters,gateDepthMeters,code);
          const centerRange=firstGateMeters+(gateIndex+.5)*gateDepthMeters;
          this.debugPanel.textContent=summary+'\n\n'+[
            'radar id: '+(sourceLayer.radar?.id||sourceLayer.id||id),
            'ray index: '+rayIndex,'gate index: '+gateIndex,
            'azimuth: '+angular.azimuths[rayIndex].toFixed(4)+'°',
            'azimuth resolution: '+beamWidth.toFixed(4)+'°',
            'range start: '+gate.r0+' m','range end: '+gate.r1+' m',
            'gate radial resolution: '+gateDepthMeters+' m',
            'tangential width estimated: '+tangential(centerRange)+' m',
            'dBZ class: '+(dbzByCode[code]??'indisponível'),
            'palette index: '+code,
            ...gate.coordinates.slice(0,4).map((coordinate,index)=>'P'+index+': '+coordinate[1].toFixed(6)+', '+coordinate[0].toFixed(6))
          ].join('\n');
        };
        this.map.on('click',this.debugClick);
      }
      this.ready=true;resolveReady(true);this.map.triggerRepaint();
    },
    setOpacity(value){this.opacity=value;if(this.debugPanel)this.debugPanel.style.display=value>0?'block':'none';this.map?.triggerRepaint()},
    setPalette(value){this.palette=value;this.map?.triggerRepaint()},
    render(gl,args){
      if(!this.ready||!this.program)return;
      gl.useProgram(this.program);gl.uniformMatrix4fv(this.uMatrix,false,args.defaultProjectionData.mainMatrix);
      gl.enableVertexAttribArray(this.aPos);gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
      for(const group of this.groups){
        gl.uniform4fv(this.uColor,rgba(this.palette?.[group.code],this.opacity));
        gl.bindBuffer(gl.ARRAY_BUFFER,group.buffer);gl.vertexAttribPointer(this.aPos,2,gl.FLOAT,false,8,0);
        gl.drawArrays(gl.TRIANGLES,0,group.vertices);
      }
    },
    onRemove(map,gl){this.abortController?.abort();if(this.debugClick)map.off('click',this.debugClick);for(const group of [...this.groups,...this.debugBuffers])gl.deleteBuffer(group.buffer);this.debugPanel?.remove();if(this.program)gl.deleteProgram(this.program);if(!this.ready&&!this.failed)resolveReady(false);this.groups=[];this.debugBuffers=[];this.ready=false}
  };
  return custom;
}
