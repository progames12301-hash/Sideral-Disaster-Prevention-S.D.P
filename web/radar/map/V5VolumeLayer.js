const EARTH_RADIUS_M=6371000;
const DEG=Math.PI/180;
const PI=Math.PI;
const MAX_SWEEPS=24;

function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`Brasil Scope V5 shader: ${error}`)}
  return shader;
}

function program(gl,vertex,fragment){
  const vs=compile(gl,gl.VERTEX_SHADER,vertex),fs=compile(gl,gl.FRAGMENT_SHADER,fragment),p=gl.createProgram();
  gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(error)}
  return p;
}

const paletteHex=colors=>colors.map(value=>{
  if(Array.isArray(value))return value;
  const n=parseInt(String(value).replace('#',''),16);return[n>>16,(n>>8)&255,n&255];
});

function beamHeight(range,elevation,radarAltitude){
  const effective=EARTH_RADIUS_M*4/3;
  return Math.sqrt(range*range+effective*effective+2*range*effective*Math.sin(elevation))-effective+radarAltitude;
}

function meterMercatorZ(altitude,latitude){
  return altitude/(2*PI*EARTH_RADIUS_M*Math.cos(latitude));
}

export function createV5VolumeLayer({id='brasil-scope-v5-volume',volume,palette=[],opacity=1}){
  let resolveReady;const readyPromise=new Promise(resolve=>resolveReady=resolve);
  const sweeps=(volume?.sweeps||[]).slice(0,MAX_SWEEPS).filter(sweep=>sweep?.dataUrl&&Number(sweep.rayCount)>0&&Number(sweep.gateCount)>0&&Array.isArray(sweep.azimuthStart)&&Array.isArray(sweep.azimuthEnd));
  const custom={id,type:'custom',renderingMode:'3d',ready:false,failed:false,opacity,readyPromise,volume,textureSets:[],vao:null,program:null,locations:null,stats:null,
    onAdd(map,gl){
      this.map=map;this.gl=gl;this.abortController=new AbortController();
      if(!gl.drawArraysInstanced||!gl.texImage2D){this.failed=true;resolveReady(false);return}
      try{
        const vertex=`#version 300 es
        precision highp float;
        precision highp int;
        uniform mat4 matrix;
        uniform sampler2D dataTex;
        uniform sampler2D rayTex;
        uniform sampler2D paletteTex;
        uniform int gates;
        uniform float gateSize;
        uniform float rangeStart;
        uniform float elevation;
        uniform float radarAltitude;
        uniform float opacity;
        uniform int velocity;
        uniform vec2 origin;
        uniform float beamWidth;
        flat out vec4 color;
        const float PI=3.141592653589793;
        const float ER=6371000.0;
        const float TWO_PI=6.283185307179586;
        float beamHeight(float range,float elev,float alt){
          float effective=ER*4.0/3.0;
          return sqrt(range*range+effective*effective+2.0*range*effective*sin(elev))-effective+alt;
        }
        void main(){
          int ray=gl_InstanceID/gates,gate=gl_InstanceID%gates;
          vec2 bytes=round(texelFetch(dataTex,ivec2(gate,ray),0).rg*255.0);
          float signedCode=bytes.x+256.0*bytes.y;
          if(signedCode>=32768.0)signedCode-=65536.0;
          float value=signedCode*.01;
          if(signedCode==-32768.0 || (velocity==0 && value<5.0)){color=vec4(0);gl_Position=vec4(2,2,2,1);return;}
          int bin=velocity==1?int(clamp(floor((value+65.0)/10.0),0.0,12.0)):int(clamp(floor((value-5.0)/5.0),0.0,13.0));
          color=texelFetch(paletteTex,ivec2(bin,0),0);color.a*=opacity;color.rgb*=color.a;
          vec2 angles=texelFetch(rayTex,ivec2(ray,0),0).rg;
          int corner=gl_VertexID;
          bool outer=corner==2||corner==4||corner==5;
          bool end=corner==1||corner==2||corner==4;
          float theta=radians(end?angles.y:angles.x);
          float slant=rangeStart+(float(gate)+(outer?1.0:0.0))*gateSize;
          float ground=ER*4.0/3.0*atan(slant*cos(elevation),(ER*4.0/3.0)+slant*sin(elevation));
          float arc=ground/ER;
          float lat=asin(sin(origin.y)*cos(arc)+cos(origin.y)*sin(arc)*cos(theta));
          float lon=origin.x+atan(sin(theta)*sin(arc)*cos(origin.y),cos(arc)-sin(origin.y)*sin(lat));
          float height=beamHeight(slant,elevation,radarAltitude);
          float thickness=max(20.0,slant*tan(radians(beamWidth*.5)));
          // The visible surface follows the real beam height. The slight vertical offset
          // gives the nested sweeps the volumetric thickness visible in the V5 reference.
          float z=height+thickness*.08;
          vec2 mercator=vec2((lon+PI)/TWO_PI,.5-log(tan(PI*.25+lat*.5))/TWO_PI);
          float mercatorZ=meterMercatorZ(z,lat);
          gl_Position=matrix*vec4(mercator,mercatorZ,1.0);
        }
        function float beamHeight(float range,float elev,float alt){
          float effective=ER*4.0/3.0;
          return sqrt(range*range+effective*effective+2.0*range*effective*sin(elev))-effective+alt;
        }`;
        const fragment=`#version 300 es
        precision highp float;flat in vec4 color;out vec4 outputColor;
        float beamHeight(float range,float elev,float alt){
          float effective=ER*4.0/3.0;
          return sqrt(range*range+effective*effective+2.0*range*effective*sin(elev))-effective+alt;
        }
        void main(){if(color.a<=0.0)discard;outputColor=color;}`;
        this.program=program(gl,vertex,fragment);this.vao=gl.createVertexArray();
        const names=['matrix','dataTex','rayTex','paletteTex','gates','gateSize','rangeStart','elevation','radarAltitude','opacity','velocity','origin','beamWidth'];
        this.locations=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(this.program,name)]));
        this.load().catch(error=>{if(error?.name!=='AbortError')console.error('Brasil Scope V5 volume:',error);this.failed=true;resolveReady(false)});
      }catch(error){console.error(error);this.failed=true;resolveReady(false)}
    },
    async load(){
      if(!sweeps.length)throw new Error('Este volume não contém sweeps físicos disponíveis.');
      const gl=this.gl;this.paletteTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.paletteTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const colors=paletteHex(palette),needed=volume.product==='velocity'?13:14,rgba=new Uint8Array(needed*4);
      for(let i=0;i<needed;i++){const c=colors[Math.min(colors.length-1,Math.round(i*(colors.length-1)/Math.max(1,needed-1)))]||[255,255,255];rgba.set([c[0],c[1],c[2],Math.round(255*(volume.product==='velocity'?.9:[.45,.6,.65,.75,.8,.85,.9,.95,.95,.95,.95,.95,.95,.95][i]))],i*4)}
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,needed,1,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      for(const sweep of sweeps){
        const response=await fetch(this.map.__v5Base+sweep.dataUrl,{signal:this.abortController.signal,cache:'no-store'});if(!response.ok)throw new Error(`Sweep ${sweep.elevation}° indisponível.`);
        const compressed=await response.arrayBuffer();
        // The API returns gzip. DecompressionStream is available in modern Chromium/Edge.
        const binary=typeof DecompressionStream==='function'?await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():compressed;
        const expected=Number(sweep.rayCount)*Number(sweep.gateCount)*2;if(binary.byteLength<expected)throw new Error(`Dados incompletos na elevação ${sweep.elevation}°.`);
        const data=new Uint8Array(binary,0,expected),rayCount=Number(sweep.rayCount),gateCount=Number(sweep.gateCount);if(Math.max(rayCount,gateCount)>gl.getParameter(gl.MAX_TEXTURE_SIZE))continue;
        const dataTex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,dataTex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,gateCount,rayCount,0,gl.RG,gl.UNSIGNED_BYTE,data);
        const rays=new Float32Array(rayCount*2);for(let i=0;i<rayCount;i++){rays[i*2]=Number(sweep.azimuthStart[i]);rays[i*2+1]=Number(sweep.azimuthEnd[i])}
        const rayTex=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,rayTex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RG32F,rayCount,1,0,gl.RG,gl.FLOAT,rays);
        this.textureSets.push({sweep,dataTex,rayTex,rayCount,gateCount});
      }
      if(!this.textureSets.length)throw new Error('Nenhum sweep pôde ser carregado no WebGL.');
      this.stats={sweeps:this.textureSets.length,elevations:this.textureSets.map(x=>Number(x.sweep.elevation)),gates:this.textureSets.reduce((n,x)=>n+x.rayCount*x.gateCount,0)};
      this.ready=true;resolveReady(true);this.map.triggerRepaint();
    },
    setOpacity(value){this.opacity=value;this.map?.triggerRepaint()},
    setPalette(value){palette=value||palette;this.map?.triggerRepaint()},
    render(gl,args){
      if(!this.ready||!this.program)return;const u=this.locations;gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.paletteTexture);gl.uniform1i(u.paletteTex,2);gl.uniformMatrix4fv(u.matrix,false,args.defaultProjectionData?.mainMatrix||args);gl.uniform1f(u.opacity,this.opacity);gl.uniform1i(u.velocity,volume.product==='velocity'?1:0);gl.uniform2f(u.origin,Number(volume.longitude)*DEG,Number(volume.latitude)*DEG);gl.uniform1f(u.radarAltitude,Number(volume.altitude)||0);gl.uniform1f(u.beamWidth,Number(volume.beamWidthDegrees)||1.0);
      for(const set of this.textureSets){const s=set.sweep;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,set.dataTex);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,set.rayTex);gl.uniform1i(u.dataTex,0);gl.uniform1i(u.rayTex,1);gl.uniform1i(u.gates,set.gateCount);gl.uniform1f(u.gateSize,Number(s.gateSize));gl.uniform1f(u.rangeStart,Number(s.rangeStart));gl.uniform1f(u.elevation,Number(s.elevation)*DEG);gl.drawArraysInstanced(gl.TRIANGLES,0,6,set.rayCount*set.gateCount)}
      gl.bindVertexArray(null);
    },
    onRemove(map,gl){this.abortController?.abort();for(const set of this.textureSets){gl.deleteTexture(set.dataTex);gl.deleteTexture(set.rayTex)}if(this.paletteTexture)gl.deleteTexture(this.paletteTexture);if(this.vao)gl.deleteVertexArray(this.vao);if(this.program)gl.deleteProgram(this.program);this.textureSets=[];this.ready=false}
  };
  return custom;
}
