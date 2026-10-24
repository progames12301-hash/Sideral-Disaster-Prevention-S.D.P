export class RadarCache {
  constructor(limit=160){this.limit=limit;this.images=new Map()}
  inspect(url, minimumWidth=1){
    if(this.images.has(url)){const cached=this.images.get(url);this.images.delete(url);this.images.set(url,cached);return cached}
    const request=new Promise(resolve=>{
      const image=new Image();image.crossOrigin='anonymous';const timer=setTimeout(()=>{image.src='';resolve({ok:false,url,reason:'timeout'})},12000);
      image.onload=()=>{clearTimeout(timer);resolve({ok:image.naturalWidth>=minimumWidth,url,width:image.naturalWidth,height:image.naturalHeight,reason:image.naturalWidth<minimumWidth?'imagem-placeholder':null})};
      image.onerror=()=>{clearTimeout(timer);resolve({ok:false,url,reason:'imagem-inexistente'})};image.src=url;
    });
    this.images.set(url,request);while(this.images.size>this.limit)this.images.delete(this.images.keys().next().value);return request;
  }
  async preload(urls,concurrency=6){
    const queue=[...new Set(urls.filter(Boolean))],results=[];
    const worker=async()=>{while(queue.length){const url=queue.shift();try{results.push(await this.inspect(url))}catch(error){results.push({ok:false,url,reason:error?.message||'erro'})}}};
    await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),queue.length||1)},worker));
    return results;
  }
}
