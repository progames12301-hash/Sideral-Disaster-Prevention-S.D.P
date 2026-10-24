const REF=['#bedfee','#90cbea','#00cce9','#63dd76','#20bb35','#007b1d','#bedb16','#ffff00','#ff9700','#ff2200','#ae0000','#f500cf','#8b30bc','#fff0ff'];
const VEL=['#003c20','#005b24','#00842b','#00b63b','#67db80','#7ae0c3','#cccccc','#ffb4cc','#f87883','#ed3232','#d41422','#9c0927','#620923'];
export function palette(product){return product==='velocity'?VEL:REF}
export class PolarLayer {
  constructor(metadata, buffer, options={}){
    this.id=options.id||'brasil-scope-v3';this.type='custom';this.renderingMode='2d';this.metadata=metadata;this.buffer=buffer;this.opacity=1;
    this.colors=Array.isArray(options.colors)&&options.colors.length?options.colors:palette(metadata.product);
    if(buffer.byteLength!==metadata.rayCount*metadata.gateCount*2)throw new Error('Quadro polar incompleto');
  }
  onAdd(map, gl){
    this.map=map;this.gl=gl;
    if(!gl.drawArraysInstanced)throw new Error('Brasil Scope V3 requer WebGL 2');
    const vertex=`#version 300 es
    precision highp float;
    precision highp int;
    uniform mat4 matrix;
    uniform sampler2D dataTex;
    uniform sampler2D rayTex;
    uniform sampler2D paletteTex;
    uniform int gates;
    uniform float gateSize, rangeStart, elevation, opacity;
    uniform int velocity;
    uniform vec2 origin;
    flat out vec4 color;
    const float PI=3.141592653589793;
    void main(){
      int ray=gl_InstanceID/gates, gate=gl_InstanceID%gates;
      vec2 bytes=round(texelFetch(dataTex,ivec2(gate,ray),0).rg*255.0);
      float code=bytes.x+256.0*bytes.y;
      if(code>=32768.0)code-=65536.0;
      float value=code*.01;
      if(code==-32768.0 || (velocity==0 && value<5.0)){color=vec4(0);gl_Position=vec4(2,2,2,1);return;}
      int bin=velocity==1?int(clamp(floor((value+65.0)/10.0),0.0,12.0)):int(clamp(floor((value-5.0)/5.0),0.0,13.0));
      color=texelFetch(paletteTex,ivec2(bin,0),0);
      color.a*=opacity;color.rgb*=color.a;
      int corner=gl_VertexID;
      bool outer=corner==2 || corner==4 || corner==5;
      bool end=corner==1 || corner==2 || corner==4;
      vec2 angles=texelFetch(rayTex,ivec2(ray,0),0).rg;
      float theta=radians(end?angles.y:angles.x);
      float slant=rangeStart+(float(gate)+(outer?1.0:0.0))*gateSize;
      float effectiveEarth=6371000.0*4.0/3.0;
      float ground=effectiveEarth*atan(slant*cos(elevation),effectiveEarth+slant*sin(elevation));
      float arc=ground/6371000.0;
      float lat=asin(sin(origin.y)*cos(arc)+cos(origin.y)*sin(arc)*cos(theta));
      float lon=origin.x+atan(sin(theta)*sin(arc)*cos(origin.y),cos(arc)-sin(origin.y)*sin(lat));
      vec2 mercator=vec2((lon+PI)/(2.0*PI),.5-log(tan(PI*.25+lat*.5))/(2.0*PI));
      gl_Position=matrix*vec4(mercator,0,1);
    }`;
    const fragment=`#version 300 es
    precision highp float;
    flat in vec4 color;
    out vec4 outputColor;
    void main(){if(color.a==0.0)discard;outputColor=color;}`;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error)}return shader};
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    const m=this.metadata;
    if(Math.max(m.rayCount,m.gateCount)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('Volume maior que o limite deste aparelho');
    this.textures=[];
    const upload=(unit,width,height,internal,format,type,bytes)=>{
      const texture=gl.createTexture();this.textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,format,type,bytes);
    };
    upload(0,m.gateCount,m.rayCount,gl.RG8,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array(this.buffer));
    const rays=new Float32Array(m.rayCount*2);
    for(let i=0;i<m.rayCount;i++){rays[2*i]=m.azimuthStart[i];rays[2*i+1]=m.azimuthEnd[i]}
    upload(1,m.rayCount,1,gl.RG32F,gl.RG,gl.FLOAT,rays);
    const base=this.colors,needed=m.product==='velocity'?13:14;
    const colors=Array.from({length:needed},(_,i)=>base[Math.min(base.length-1,Math.round(i*(base.length-1)/Math.max(1,needed-1)))]),rgba=new Uint8Array(colors.length*4);
    colors.forEach((hex,i)=>{const n=parseInt(hex.slice(1),16);rgba.set([n>>16,(n>>8)&255,n&255,Math.round(255*(m.product==='velocity'?.95:[.45,.60,.65,.75,.8,.85,.9,.95,.95,.95,.95,.95,.95,.95][i]))],i*4)});
    upload(2,colors.length,1,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    this.vao=gl.createVertexArray();this.locations={};
    for(const name of ['matrix','dataTex','rayTex','paletteTex','gates','gateSize','rangeStart','elevation','opacity','velocity','origin'])this.locations[name]=gl.getUniformLocation(this.program,name);
  }
  render(gl, args){
    const m=this.metadata,u=this.locations;
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    this.textures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture)});
    gl.uniform1i(u.dataTex,0);gl.uniform1i(u.rayTex,1);gl.uniform1i(u.paletteTex,2);
    gl.uniformMatrix4fv(u.matrix,false,args.defaultProjectionData?.mainMatrix||args);
    gl.uniform1i(u.gates,m.gateCount);gl.uniform1i(u.velocity,m.product==='velocity'?1:0);
    gl.uniform1f(u.gateSize,m.gateSize);gl.uniform1f(u.rangeStart,m.rangeStart);gl.uniform1f(u.elevation,m.elevation*Math.PI/180);gl.uniform1f(u.opacity,this.opacity);
    gl.uniform2f(u.origin,m.longitude*Math.PI/180,m.latitude*Math.PI/180);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,m.rayCount*m.gateCount);
    gl.bindVertexArray(null);
  }
  onRemove(map,gl){for(const t of this.textures||[])gl.deleteTexture(t);if(this.vao)gl.deleteVertexArray(this.vao);if(this.program)gl.deleteProgram(this.program)}
}
