const word=value=>[value&255,(value>>8)&255];

const BIN_COUNT=32*32*32;

function opaqueChannel(value,alpha){return Math.round(value*alpha+255*(1-alpha))}
function rgbKey(red,green,blue){return ((red>>3)<<10)|((green>>3)<<5)|(blue>>3)}
function keyColor(key){return {key,red:Math.round(((key>>10)&31)*255/31),green:Math.round(((key>>5)&31)*255/31),blue:Math.round((key&31)*255/31)}}

function colorHistogram(rgba){
  const histogram=new Uint32Array(BIN_COUNT),pixels=rgba.length/4;
  const sampleStep=Math.max(1,Math.ceil(pixels/900000));
  for(let pixel=0;pixel<pixels;pixel+=sampleStep){
    const source=pixel*4,alpha=rgba[source+3]/255;
    const red=opaqueChannel(rgba[source],alpha),green=opaqueChannel(rgba[source+1],alpha),blue=opaqueChannel(rgba[source+2],alpha);
    const saturation=Math.max(red,green,blue)-Math.min(red,green,blue);
    histogram[rgbKey(red,green,blue)]+=1+(saturation>>5);
  }
  const colors=[];
  for(let key=0;key<histogram.length;key++)if(histogram[key])colors.push({...keyColor(key),count:histogram[key]});
  return colors;
}

function colorBox(colors){
  let redMin=255,redMax=0,greenMin=255,greenMax=0,blueMin=255,blueMax=0,population=0;
  for(const color of colors){redMin=Math.min(redMin,color.red);redMax=Math.max(redMax,color.red);greenMin=Math.min(greenMin,color.green);greenMax=Math.max(greenMax,color.green);blueMin=Math.min(blueMin,color.blue);blueMax=Math.max(blueMax,color.blue);population+=color.count}
  return {colors,population,ranges:[redMax-redMin,greenMax-greenMin,blueMax-blueMin]};
}

function splitColorBox(box){
  const channel=box.ranges[1]>=box.ranges[0]&&box.ranges[1]>=box.ranges[2]?'green':box.ranges[0]>=box.ranges[2]?'red':'blue';
  const colors=box.colors.slice().sort((a,b)=>a[channel]-b[channel]);
  const middle=box.population/2;let weight=0,index=1;
  for(;index<colors.length;index++){weight+=colors[index-1].count;if(weight>=middle)break}
  index=Math.min(colors.length-1,Math.max(1,index));
  return [colorBox(colors.slice(0,index)),colorBox(colors.slice(index))];
}

function adaptivePalette(rgba){
  const colors=colorHistogram(rgba),boxes=[colorBox(colors.length?colors:[{red:255,green:255,blue:255,count:1}])];
  while(boxes.length<256){
    let selected=-1,best=-1;
    for(let index=0;index<boxes.length;index++){
      const box=boxes[index];if(box.colors.length<2)continue;
      const score=Math.max(...box.ranges)*Math.sqrt(box.population);
      if(score>best){best=score;selected=index}
    }
    if(selected<0)break;
    boxes.splice(selected,1,...splitColorBox(boxes[selected]));
  }
  const palette=new Uint8Array(256*3);
  boxes.forEach((box,index)=>{
    let red=0,green=0,blue=0,total=0;
    for(const color of box.colors){red+=color.red*color.count;green+=color.green*color.count;blue+=color.blue*color.count;total+=color.count}
    palette[index*3]=Math.round(red/total);palette[index*3+1]=Math.round(green/total);palette[index*3+2]=Math.round(blue/total);
  });
  const fallback=Math.max(0,boxes.length-1)*3;
  for(let index=boxes.length;index<256;index++){palette[index*3]=palette[fallback];palette[index*3+1]=palette[fallback+1];palette[index*3+2]=palette[fallback+2]}
  return palette;
}

function quantizeAdaptive(rgba,palette){
  const indexed=new Uint8Array(rgba.length/4),lookup=new Int16Array(BIN_COUNT);lookup.fill(-1);
  for(let source=0,target=0;source<rgba.length;source+=4,target++){
    const alpha=rgba[source+3]/255;
    const red=opaqueChannel(rgba[source],alpha),green=opaqueChannel(rgba[source+1],alpha),blue=opaqueChannel(rgba[source+2],alpha),key=rgbKey(red,green,blue);
    let match=lookup[key];
    if(match<0){
      let distance=Number.POSITIVE_INFINITY;match=0;
      for(let index=0;index<256;index++){
        const offset=index*3,deltaRed=red-palette[offset],deltaGreen=green-palette[offset+1],deltaBlue=blue-palette[offset+2];
        const candidate=deltaRed*deltaRed*2+deltaGreen*deltaGreen*4+deltaBlue*deltaBlue;
        if(candidate<distance){distance=candidate;match=index;if(candidate===0)break}
      }
      lookup[key]=match;
    }
    indexed[target]=match;
  }
  return indexed;
}

function lzw(indices){
  const clearCode=256,endCode=257;
  let codeSize=9,nextCode=258,dictionary=new Map();
  const output=[];
  let bitBuffer=0,bitCount=0;
  const emit=code=>{
    bitBuffer|=code<<bitCount;
    bitCount+=codeSize;
    while(bitCount>=8){output.push(bitBuffer&255);bitBuffer>>>=8;bitCount-=8}
  };
  const reset=()=>{dictionary=new Map();codeSize=9;nextCode=258};
  emit(clearCode);
  if(!indices.length){emit(endCode);if(bitCount)output.push(bitBuffer&255);return Uint8Array.from(output)}
  let prefix=indices[0];
  for(let index=1;index<indices.length;index++){
    const suffix=indices[index];
    const key=prefix*256+suffix;
    const known=dictionary.get(key);
    if(known!==undefined){prefix=known;continue}
    emit(prefix);
    if(nextCode<4096){
      dictionary.set(key,nextCode++);
      // O codificador fica uma entrada à frente do decodificador. A troca
      // de 9 para 10 bits (e seguintes) só pode acontecer no código posterior.
      if(nextCode>(1<<codeSize)&&codeSize<12)codeSize++;
    }else{
      emit(clearCode);
      reset();
    }
    prefix=suffix;
  }
  emit(prefix);emit(endCode);
  if(bitCount)output.push(bitBuffer&255);
  return Uint8Array.from(output);
}

export class GifEncoder{
  constructor(width,height,{delay=75,loop=0}={}){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535)throw new Error('Dimensões inválidas para o GIF.');
    this.width=width;this.height=height;this.delay=Math.max(2,Math.round(delay/10));this.loop=loop;this.parts=[];this.frameCount=0;this.palette=null;
  }
  bytes(...values){this.parts.push(Uint8Array.from(values))}
  header(rgba){
    this.palette=adaptivePalette(rgba);
    this.bytes(71,73,70,56,57,97,...word(this.width),...word(this.height),0xf7,0,0);
    this.parts.push(this.palette);
    this.bytes(0x21,0xff,0x0b,78,69,84,83,67,65,80,69,50,46,48,3,1,...word(this.loop),0);
  }
  addFrame(rgba,delayMs){
    if(!rgba||rgba.length!==this.width*this.height*4)throw new Error('O quadro do GIF tem dimensões diferentes da animação.');
    if(!this.palette)this.header(rgba);
    const delay=delayMs==null?this.delay:Math.max(2,Math.round(delayMs/10));
    this.bytes(0x21,0xf9,4,0x04,...word(delay),0,0);
    this.bytes(0x2c,0,0,0,0,...word(this.width),...word(this.height),0,8);
    const compressed=lzw(quantizeAdaptive(rgba,this.palette));
    for(let offset=0;offset<compressed.length;offset+=255){const block=compressed.slice(offset,offset+255);this.bytes(block.length);this.parts.push(block)}
    this.bytes(0);this.frameCount++;
  }
  finish(){if(!this.frameCount)throw new Error('O GIF não possui quadros.');this.bytes(0x3b);return new Blob(this.parts,{type:'image/gif'})}
}
