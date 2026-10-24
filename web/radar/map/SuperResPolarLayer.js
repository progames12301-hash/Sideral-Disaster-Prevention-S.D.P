// SuperResPolarLayer — varredura polar em células discretas.
//
// O modo Super Res é deliberadamente diferente do raster CAPPI:
// cada amostra é reconstruída como um gate polar individual, formando o
// padrão "cata-vento" da referência, com radiais finas, blocos rígidos,
// bordas visuais discretas e centro/áreas sem eco transparentes.
//
// IMPORTANTE: nenhum eco é criado. Cada gate consulta somente o pixel
// correspondente do produto de origem. A geometria é física (azimute +
// distância) e só a representação visual é refinada.

import {
  calibrateRadarProfile,
  resolveRadarProfile
} from './RadarProfiles.js?v=20260914-v5-clean25';

const EARTH_RADIUS_KM=6371.0088;
const NO_ECHO=255;

// Super-resolution visual desejada nas referências.
export const SUPER_RES_AZIMUTH_RESOLUTION_DEG=0.5;
export const SUPER_RES_GATE_DEPTH_METERS=250;

// Pequeno centro sem dados, para evitar o "buraco branco" produzido por
// pixels do próprio radar/site e deixar a convergência visual limpa.
const SUPER_RES_CENTER_HOLE_FRACTION=0.058;

// A referência mostra gates como placas separadas, mas sem abrir grandes
// rachaduras. O recuo é pequeno e fica ainda menor em zoom baixo.
const CELL_GAP_RADIAL_METERS=7;
const CELL_GAP_ANGULAR_DEG=0.018;

// ---------- Geometria ----------------------------------------------------

function destinationPoint(radarLat,radarLon,distanceMeters,bearingDegrees){
  const distance=distanceMeters/1000/EARTH_RADIUS_KM;
  const bearing=bearingDegrees*Math.PI/180;
  const lat1=radarLat*Math.PI/180;
  const lon1=radarLon*Math.PI/180;
  const lat2=Math.asin(
    Math.sin(lat1)*Math.cos(distance)+
    Math.cos(lat1)*Math.sin(distance)*Math.cos(bearing)
  );
  const lon2=lon1+Math.atan2(
    Math.sin(bearing)*Math.sin(distance)*Math.cos(lat1),
    Math.cos(distance)-Math.sin(lat1)*Math.sin(lat2)
  );
  return [
    ((lon2*180/Math.PI+540)%360)-180,
    lat2*180/Math.PI
  ];
}

function mercatorY(latitude){
  const sin=Math.sin(
    Math.max(-85.0511,Math.min(85.0511,latitude))*Math.PI/180
  );
  return .5-Math.log((1+sin)/(1-sin))/(4*Math.PI);
}

function imagePixel(coordinate,coordinates,width,height){
  const west=Number(coordinates[0][0]);
  const east=Number(coordinates[1][0]);
  const north=Number(coordinates[0][1]);
  const south=Number(coordinates[2][1]);
  const northY=mercatorY(north);
  const southY=mercatorY(south);
  const x=(coordinate[0]-west)/(east-west)*(width-1);
  const y=(mercatorY(coordinate[1])-northY)/(southY-northY)*(height-1);
  return [x,y];
}

function haversineKm(a,b){
  const lat1=a[1]*Math.PI/180;
  const lat2=b[1]*Math.PI/180;
  const dLat=lat2-lat1;
  const dLon=(b[0]-a[0])*Math.PI/180;
  const h=
    Math.sin(dLat/2)**2+
    Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*EARTH_RADIUS_KM*Math.asin(Math.min(1,Math.sqrt(h)));
}

function layerRangeKm(sourceLayer,origin){
  const explicit=Number(sourceLayer.radar?.rangeKm);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const c=sourceLayer.coordinates;
  if(!Array.isArray(c)||c.length<4)return 250;
  const west=Number(c[0][0]);
  const east=Number(c[1][0]);
  const north=Number(c[0][1]);
  const south=Number(c[2][1]);
  const candidates=[
    haversineKm(origin,[west,origin[1]]),
    haversineKm(origin,[east,origin[1]]),
    haversineKm(origin,[origin[0],north]),
    haversineKm(origin,[origin[0],south])
  ].filter(value=>Number.isFinite(value)&&value>0);
  return candidates.length?Math.min(...candidates):250;
}

// ---------- Classificação -------------------------------------------------

function createProgram(gl){
  function compileShader(type,source){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
      const error=gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Super Res shader: ${error}`);
    }
    return shader;
  }

  const vertex=compileShader(gl.VERTEX_SHADER,`#version 300 es
    uniform mat4 u_matrix;
    in vec2 a_pos;
    void main(){
      gl_Position=u_matrix*vec4(a_pos,0.0,1.0);
    }`);

  const fragment=compileShader(gl.FRAGMENT_SHADER,`#version 300 es
    precision mediump float;
    uniform vec4 u_color;
    out vec4 fragColor;
    void main(){
      fragColor=u_color;
    }`);

  const program=gl.createProgram();
  gl.attachShader(program,vertex);
  gl.attachShader(program,fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
    const error=gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Super Res program: ${error}`);
  }
  return program;
}

async function decodeImage(url,signal){
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`Super Res radar HTTP ${response.status}`);
  const bitmap=await createImageBitmap(await response.blob());
  const canvas=
    typeof OffscreenCanvas!=='undefined'
      ?new OffscreenCanvas(bitmap.width,bitmap.height)
      :Object.assign(document.createElement('canvas'),{
        width:bitmap.width,
        height:bitmap.height
      });
  const context=canvas.getContext('2d',{
    alpha:true,
    willReadFrequently:true
  });
  context.imageSmoothingEnabled=false;
  context.clearRect(0,0,bitmap.width,bitmap.height);
  context.drawImage(bitmap,0,0);
  bitmap.close?.();
  return context.getImageData(0,0,canvas.width,canvas.height);
}

function rgba(color,opacity){
  return [
    (color?.[0]??255)/255,
    (color?.[1]??255)/255,
    (color?.[2]??255)/255,
    opacity
  ];
}

// ---------- Gate polar ----------------------------------------------------

function createGate(
  radarLat,
  radarLon,
  azimuth,
  beamWidth,
  rangeStart,
  gateDepth,
  value
){
  const safeBeam=Math.max(
    0.04,
    Math.min(
      beamWidth||SUPER_RES_AZIMUTH_RESOLUTION_DEG,
      SUPER_RES_AZIMUTH_RESOLUTION_DEG
    )
  );
  const gapA=CELL_GAP_ANGULAR_DEG;
  const a0=azimuth-safeBeam/2+gapA;
  const a1=azimuth+safeBeam/2-gapA;

  const gap=Math.min(CELL_GAP_RADIAL_METERS,gateDepth*.18);
  const r0=Math.max(0,rangeStart+gap/2);
  const r1=Math.max(r0+1,rangeStart+gateDepth-gap/2);

  const p1=destinationPoint(radarLat,radarLon,r0,a0);
  const p2=destinationPoint(radarLat,radarLon,r1,a0);
  const p3=destinationPoint(radarLat,radarLon,r1,a1);
  const p4=destinationPoint(radarLat,radarLon,r0,a1);

  return {
    coordinates:[p1,p2,p3,p4],
    value,
    r0,
    r1,
    a0,
    a1
  };
}

// ---------- Camada --------------------------------------------------------

export function createSuperResPolarLayer({
  id,
  sourceLayer={},
  palette,
  classify,
  dbzByCode=[],
  opacity=1
}){
  const existingPolar=sourceLayer.polar||sourceLayer.radar?.polar||{};

  // Super Res nunca engrossa uma fonte que já tenha resolução melhor.
  const nativeGate=Number(
    existingPolar.rangeResolutionMeters ??
    existingPolar.gateSizeMeters ??
    sourceLayer.radar?.rangeResolutionMeters
  );
  const nativeAzimuth=Number(
    existingPolar.azimuthResolutionDegrees ??
    existingPolar.raySpacingDegrees ??
    sourceLayer.radar?.azimuthResolutionDegrees
  );

  const rangeResolutionMeters=
    Number.isFinite(nativeGate)&&nativeGate>0&&
    nativeGate<=SUPER_RES_GATE_DEPTH_METERS
      ?nativeGate
      :SUPER_RES_GATE_DEPTH_METERS;

  const azimuthResolutionDegrees=
    Number.isFinite(nativeAzimuth)&&nativeAzimuth>0&&
    nativeAzimuth<=SUPER_RES_AZIMUTH_RESOLUTION_DEG
      ?nativeAzimuth
      :SUPER_RES_AZIMUTH_RESOLUTION_DEG;

  const forcedLayer={
    ...sourceLayer,
    radar:{
      ...(sourceLayer.radar||{})
    },
    polar:{
      ...existingPolar,
      rangeResolutionMeters,
      azimuthResolutionDegrees
    }
  };

  let resolveReady;
  const readyPromise=new Promise(resolve=>{resolveReady=resolve});

  const custom={
    id,
    type:'custom',
    renderingMode:'2d',
    ready:false,
    failed:false,
    opacity,
    palette,
    groups:[],
    readyPromise,

    onAdd(map,gl){
      this.map=map;
      this.gl=gl;
      this.abortController=new AbortController();

      try{
        this.program=createProgram(gl);
        this.aPos=gl.getAttribLocation(this.program,'a_pos');
        this.uMatrix=gl.getUniformLocation(this.program,'u_matrix');
        this.uColor=gl.getUniformLocation(this.program,'u_color');
      }catch(error){
        this.failed=true;
        resolveReady(false);
        console.error(error);
        return;
      }

      void this.prepare().catch(error=>{
        if(error?.name!=='AbortError'){
          console.error('Sideral Super Res:',error);
        }
        this.failed=true;
        resolveReady(false);
      });
    },

    async prepare(){
      const image=await decodeImage(
        forcedLayer.url,
        this.abortController.signal
      );

      let profile=resolveRadarProfile(forcedLayer);

      const radarLat=Number(
        forcedLayer.radar?.latitude??profile.latitude
      );
      const radarLon=Number(
        forcedLayer.radar?.longitude??profile.longitude
      );

      if(
        !Number.isFinite(radarLat)||
        !Number.isFinite(radarLon)||
        !Array.isArray(forcedLayer.coordinates)||
        forcedLayer.coordinates.length<4
      ){
        throw new Error('Radar Super Res sem origem geográfica exata.');
      }

      const maxRangeMeters=
        layerRangeKm(forcedLayer,[radarLon,radarLat])*1000;

      profile=calibrateRadarProfile(
        profile,
        image,
        maxRangeMeters,
        forcedLayer
      );

      // Para Super Res, o valor visual fica preso em 0,5° quando a fonte
      // não publicar uma geometria ainda mais fina.
      const spacing=Math.min(
        SUPER_RES_AZIMUTH_RESOLUTION_DEG,
        Number(
          forcedLayer.polar?.azimuthResolutionDegrees||
          SUPER_RES_AZIMUTH_RESOLUTION_DEG
        )
      );

      const suppliedAzimuths=Array.isArray(forcedLayer.polar?.azimuths)
        ?forcedLayer.polar.azimuths.map(Number).filter(Number.isFinite)
        :[];

      const azimuths=suppliedAzimuths.length
        ?suppliedAzimuths
        :Array.from(
          {
            length:Math.max(1,Math.round(360/spacing))
          },
          (_,index)=>(index*spacing)%360
        );

      const beamWidth=Math.min(
        spacing,
        Number.isFinite(nativeAzimuth)&&nativeAzimuth>0
          ?nativeAzimuth
          :spacing
      );

      const firstGateMeters=
        profile.firstGateMeters!==null&&
        profile.firstGateMeters!==undefined&&
        Number.isFinite(Number(profile.firstGateMeters))
          ?Math.max(0,Number(profile.firstGateMeters))
          :Math.max(
            0,
            maxRangeMeters*SUPER_RES_CENTER_HOLE_FRACTION
          );

      const usableRangeMeters=Math.max(
        1,
        maxRangeMeters-firstGateMeters
      );

      const requestedGateCount=Math.max(
        1,
        Math.ceil(usableRangeMeters/rangeResolutionMeters)
      );

      // 250 m é a unidade física. O teto só protege equipamentos fracos
      // contra rasters absurdamente grandes; não altera a resolução mínima.
      const gateCount=Math.min(
        requestedGateCount,
        Number(profile.maxGates)||2200
      );

      const effectiveGateDepth=
        usableRangeMeters/gateCount;

      const total=azimuths.length*gateCount;
      const codes=new Uint8Array(total);
      codes.fill(NO_ECHO);

      const counts=new Uint32Array(16);

      for(let rayIndex=0;rayIndex<azimuths.length;rayIndex++){
        const azimuth=azimuths[rayIndex];

        for(let gateIndex=0;gateIndex<gateCount;gateIndex++){
          const rangeStart=
            firstGateMeters+gateIndex*effectiveGateDepth;
          const centerRange=
            rangeStart+effectiveGateDepth*.5;

          // Uma amostra real por gate, sem interpolação e sem criar eco.
          const center=destinationPoint(
            radarLat,
            radarLon,
            centerRange,
            azimuth
          );

          const [x,y]=imagePixel(
            center,
            forcedLayer.coordinates,
            image.width,
            image.height
          );

          const px=Math.round(x);
          const py=Math.round(y);

          if(
            px<0||px>=image.width||
            py<0||py>=image.height
          )continue;

          const sample=(py*image.width+px)*4;
          const alpha=image.data[sample+3];

          if(alpha<18)continue;

          const maxChannel=Math.max(
            image.data[sample],
            image.data[sample+1],
            image.data[sample+2]
          );

          // Fundo/preenchimento escuro do produto não vira refletividade.
          if(maxChannel<18)continue;

          const code=classify(image.data,sample);

          if(
            !Number.isInteger(code)||
            code===NO_ECHO||
            code<0||
            code>=counts.length
          )continue;

          codes[rayIndex*gateCount+gateIndex]=code;
          counts[code]++;
        }

        if((rayIndex&15)===15){
          if(this.abortController.signal.aborted)return;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }

      const positions=Array.from(
        counts,
        count=>new Float32Array(count*12)
      );
      const offsets=new Uint32Array(counts.length);

      for(let rayIndex=0;rayIndex<azimuths.length;rayIndex++){
        const azimuth=azimuths[rayIndex];

        for(let gateIndex=0;gateIndex<gateCount;gateIndex++){
          const code=
            codes[rayIndex*gateCount+gateIndex];

          if(code===NO_ECHO)continue;

          const gate=createGate(
            radarLat,
            radarLon,
            azimuth,
            beamWidth,
            firstGateMeters+gateIndex*effectiveGateDepth,
            effectiveGateDepth,
            code
          );

          const corners=gate.coordinates.map(point=>
            maplibregl.MercatorCoordinate.fromLngLat(point)
          );

          const target=positions[code];
          const offset=offsets[code];

          // Dois triângulos = uma célula polar rígida.
          target.set([
            corners[0].x,corners[0].y,
            corners[1].x,corners[1].y,
            corners[2].x,corners[2].y,

            corners[0].x,corners[0].y,
            corners[2].x,corners[2].y,
            corners[3].x,corners[3].y
          ],offset);

          offsets[code]+=12;
        }

        if((rayIndex&15)===15){
          if(this.abortController.signal.aborted)return;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }

      if(this.abortController.signal.aborted)return;

      this.groups=[];

      for(let code=0;code<positions.length;code++){
        if(!positions[code].length)continue;

        const buffer=this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);
        this.gl.bufferData(
          this.gl.ARRAY_BUFFER,
          positions[code],
          this.gl.STATIC_DRAW
        );

        this.groups.push({
          code,
          buffer,
          vertices:positions[code].length/2
        });
      }

      const renderedGates=counts.reduce(
        (sum,count)=>sum+count,
        0
      );

      this.stats={
        radarId:forcedLayer.radar?.id||forcedLayer.id||id,
        mode:'Super Res',
        geometry:'polar cells',
        totalRays:azimuths.length,
        azimuthResolution:beamWidth.toFixed(3)+'°',
        totalGates:total,
        renderedGates,
        rangeResolution:Math.round(effectiveGateDepth)+' m',
        sourceRangeResolution:rangeResolutionMeters+' m',
        maxRange:Math.round(maxRangeMeters/1000)+' km',
        centerHole:Math.round(
          firstGateMeters/1000
        )+' km'
      };

      this.ready=true;
      resolveReady(true);
      this.map.triggerRepaint();
    },

    setOpacity(value){
      this.opacity=value;
      this.map?.triggerRepaint();
    },

    setPalette(value){
      this.palette=value;
      this.map?.triggerRepaint();
    },

    render(gl,args){
      if(!this.ready||!this.program)return;

      gl.useProgram(this.program);
      gl.uniformMatrix4fv(
        this.uMatrix,
        false,
        args.defaultProjectionData.mainMatrix
      );

      gl.enableVertexAttribArray(this.aPos);
      gl.enable(gl.BLEND);
      gl.blendFunc(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.disable(gl.CULL_FACE);

      // Sem smoothing: a aparência continua "pixel/gate",
      // como na referência.
      for(const group of this.groups){
        gl.uniform4fv(
          this.uColor,
          rgba(
            this.palette?.[group.code],
            this.opacity
          )
        );

        gl.bindBuffer(
          gl.ARRAY_BUFFER,
          group.buffer
        );

        gl.vertexAttribPointer(
          this.aPos,
          2,
          gl.FLOAT,
          false,
          8,
          0
        );

        gl.drawArrays(
          gl.TRIANGLES,
          0,
          group.vertices
        );
      }
    },

    onRemove(map,gl){
      this.abortController?.abort();

      for(const group of this.groups){
        gl.deleteBuffer(group.buffer);
      }

      this.groups=[];
      this.ready=false;

      if(this.program){
        gl.deleteProgram(this.program);
      }

      if(!this.failed){
        resolveReady(false);
      }
    }
  };

  return custom;
}
