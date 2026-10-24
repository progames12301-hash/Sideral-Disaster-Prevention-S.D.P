import {CONFIG,preference,savePreference,fetchJson,proxyBase} from './config.js?v=20260905-boundaries1';import {RadarCache} from './RadarCache.js?v=20260826-smooth2';import {RadarAnimation} from './RadarAnimation.js?v=20260827-live1';import {MapManager} from './map/MapManager.js?v=20260905-boundaries1';import {RadarControls} from './ui/RadarControls.js?v=20260905-boundaries1';import {RainViewerProvider} from './providers/RainViewerProvider.js?v=20260828-supreme4k1';import {RedemetProvider} from './providers/RedemetProvider.js?v=20260904-crisp5';import {CemadenProvider} from './providers/CemadenProvider.js?v=20260828-supreme4k1';import {RegionalProvider} from './providers/RegionalProvider.js?v=20260831-rs-clean1';import {IPMetProvider} from './providers/IPMetProvider.js?v=20260828-supreme4k1';import {IneaProvider} from './providers/IneaProvider.js';import {SimeparProvider} from './providers/SimeparProvider.js?v=20260826-scope1';import {GifEncoder} from './GifEncoder.js?v=20260827-export1';
import {RADAR_STYLES} from './RadarStyles.js?v=20260914-v5-clean25';
import {ScopeV3} from './v3/Controller.js?v=20260914-v5-clean25';
import {MapManager as MapManagerFresh} from './map/MapManager.js?v=20260914-v5-clean25';
import {RadarControls as RadarControlsFresh} from './ui/RadarControls.js?v=20260910-all-sources2';
const EXPORT_PRESETS=Object.freeze({standard:{pixelRatio:1.5,pngWidth:1920,pngHeight:1200,gifWidth:960,gifHeight:960},high:{pixelRatio:2,pngWidth:2560,pngHeight:1600,gifWidth:1440,gifHeight:1440},maximum:{pixelRatio:3,pngWidth:3840,pngHeight:2400,gifWidth:1920,gifHeight:1920},supreme4k:{pixelRatio:4,pngWidth:3840,pngHeight:2160,gifWidth:1920,gifHeight:1080}});
const DOPPLER_UNAVAILABLE=[];
const PRODUCT_PROFILES=Object.freeze({
  map:{detail:'Seleção pelo mapa',products:[{value:'none',label:'Escolha um radar no mapa',detail:'Clique em um ponto vermelho para ligar o radar',icon:'ph-map-pin'}],unavailable:DOPPLER_UNAVAILABLE},
  all:{detail:'Radares',products:[{value:'multi',label:'Mosaico de múltiplas fontes',detail:'Visão combinada do Brasil',icon:'ph-stack'}],unavailable:DOPPLER_UNAVAILABLE},
  all_no_rainviewer:{detail:'Radares do Brasil',products:[{value:'multi_official',label:'Todos os radares — sem RainViewer',detail:'REDEMET, CEMADEN e redes regionais no mesmo mapa',icon:'ph-stack'}],unavailable:DOPPLER_UNAVAILABLE},
  rainviewer:{detail:'RainViewer',products:[{value:'composite',label:'Refletividade composta',detail:'Mosaico de precipitação',icon:'ph-cloud-rain'}],unavailable:DOPPLER_UNAVAILABLE},
  redemet:{detail:'REDEMET / DECEA',multi:true,products:[{value:'maxcappi',label:'Refletividade composta — MAXCAPPI',detail:'Máximo vertical · alcance de 400 km',icon:'ph-stack-simple'},{value:'03km',label:'Refletividade — CAPPI 3,1 km',detail:'Baixa camada · alcance de 250 km',icon:'ph-number-circle-three'},{value:'05km',label:'Refletividade — CAPPI 5,5 km',detail:'Camada média · alcance de 250 km',icon:'ph-number-circle-five'},{value:'07km',label:'Refletividade — CAPPI 7,3 km',detail:'Camada alta · alcance de 250 km',icon:'ph-number-circle-seven'},{value:'10km',label:'Refletividade — CAPPI 10,4 km',detail:'Topo da alta troposfera · alcance de 250 km',icon:'ph-arrow-up'}],unavailable:DOPPLER_UNAVAILABLE},
  cemaden:{detail:'CEMADEN',products:[{value:'cappi3',label:'Refletividade — CAPPI 3 km',detail:'Até cinco varreduras públicas recentes · 250 km',icon:'ph-radar'},{value:'velocity',label:'Velocidade radial — Doppler',detail:'Velocidade radial nativa do radar CEMADEN',icon:'ph-waveform'}],unavailable:DOPPLER_UNAVAILABLE},
  regional:{detail:'Redes regionais',products:[{value:'reflectivity',label:'Refletividade — redes regionais',detail:'Imagens oficiais disponíveis no momento',icon:'ph-map-pin-line'},{value:'ppi_v',label:'Velocidade radial — PPI-V (SC)',detail:'Doppler da Defesa Civil de Santa Catarina',icon:'ph-waveform'}],unavailable:DOPPLER_UNAVAILABLE},
  inea:{detail:'INEA',products:[{value:'zh',label:'Refletividade horizontal — ZH',detail:'Intensidade dos ecos em refletividade',icon:'ph-cloud-rain'},{value:'rr',label:'Taxa de chuva — RR',detail:'Estimativa de precipitação instantânea',icon:'ph-drop'},{value:'vel',label:'PPI V — velocidade radial Doppler',detail:'Produto Doppler nativo do radar · m/s',icon:'ph-arrows-left-right'}],unavailable:DOPPLER_UNAVAILABLE},
  simepar:{detail:'SIMEPAR',products:[{value:'reflectivity',label:'Refletividade — mosaico',detail:'Ecos do radar de Cascavel',icon:'ph-radar'}],unavailable:DOPPLER_UNAVAILABLE},
  ipmet:{detail:'IPMet',products:[{value:'ppi',label:'Refletividade — PPI combinado',detail:'Mosaico operacional de São Paulo',icon:'ph-radar'}],unavailable:DOPPLER_UNAVAILABLE}
});
// Os modos polares usam a mesma malha de gates; cada um mantém sua própria
// densidade/paleta (Pixel, RadarScope, RadarScope HD e Brazil Scope).
const RADARSCOPE_CAPPI_MODES=Object.freeze(new Set(['pixel','mirror','usa_radial','radarscope_v2_hd','brazil_scope','brazil_scope_v2','brasil_scope_v3','brasil_scope_v4','brasil_scope_v5','super_res','sideral_hub']));
const RADARSCOPE_CAPPI_PRODUCTS=Object.freeze({redemet:'03km',cemaden:'cappi3'});
const RADARSCOPE_PREFERRED_SOURCE='redemet';
const COMBINED_SOURCES=Object.freeze({
  all:['rainviewer','redemet','cemaden','regional','inea','simepar','ipmet'],
  all_no_rainviewer:['redemet','cemaden','regional','inea','simepar','ipmet']
});
const CPTEC_LOCATIONS=Object.freeze({'cptec-chapeco':[-52.62,-27.1],almenara:[-40.69,-16.18],'bauru-e-pres-prud':[-50,-22.3],belem:[-48.44,-1.41],'boa-vista':[-60.67,2.82],cangucu:[-52.68,-31.4],'cruzeiro-do-sul':[-72.67,-7.63],gama:[-48.04,-15.99],jaraguari:[-54.4,-20.14],lontras:[-49.54,-27.16],macapa:[-51.07,.04],maceio:[-35.77,-9.55],manaus:[-59.99,-3.15],'morro-igreja':[-49.48,-28.13],natal:[-35.2,-5.84],petrolina:[-40.54,-9.37],'pico-do-couto':[-43.29,-22.46],'porto-velho':[-63.9,-8.71],quixeramobim:[-39.29,-5.17],salvador:[-38.51,-12.99],santarem:[-54.71,-2.44],santiago:[-54.88,-29.19],'sao-francisco':[-44.86,-15.95],'sao-gabriel':[-67.09,-.13],'sao-luiz':[-44.21,-2.59],'sao-roque':[-47.09,-23.6],tabatinga:[-69.94,-4.25],tefe:[-64.72,-3.38],'tres-marias':[-45.24,-18.2]});
const REDEMET_PRODUCTS=new Set(PRODUCT_PROFILES.redemet.products.map(product=>product.value));
const DOPPLER_PALETTES=new Set(['doppler_cptec','wx_bv','doppler_sr','wx_cc','wx_doppler']);
const savedCappiProducts=()=>{const previous=preference('sideralRadarProduct','03km');try{const values=JSON.parse(preference('sideralRadarCappiProducts',JSON.stringify([previous])));const valid=Array.isArray(values)?values.filter(value=>REDEMET_PRODUCTS.has(value)):[];return valid.length?[...new Set(valid)]:['03km']}catch{return REDEMET_PRODUCTS.has(previous)?[previous]:['03km']}};
// WxTools: as paletas de refletividade agora são estilos próprios em RadarStyles.js.
// Produtos Doppler/polarimétricos NUNCA são simulados a partir de CAPPI.
const WXTOOLS_STYLE_ALIASES=Object.freeze({
  wx_scope5:'wx_scope5',
  wx_radarscope:'wx_radarscope',
  wx_nws_crh:'wx_nws_crh',
  wx_nssl_iii:'wx_nssl_iii',
  wx_quad_weather:'wx_quad_weather',
  wx_jesse_radar:'wx_jesse_radar',
  wx_nws_sr:'wx_nws_sr',
  wx_awips:'wx_awips',
  wx_gr2analyst:'wx_gr2analyst',
  wx_nexrad_hd:'wx_nexrad_hd',
  wx_dark_sky:'wx_dark_sky',
  wx_tropical_hd:'wx_tropical_hd',
  wx_doppler:'wx_doppler',
  wx_bv:'wx_bv',
  wx_cc:'wx_cc'
});
export class RadarManager{
  constructor(){
    const savedStyle=preference('sideralRadarStyle','normal');
    const savedPalette=preference('sideralRadarPaletteChoice','wx_radarscope');
    this.cache=new RadarCache();this.source='redemet';this.cappiProducts=savedCappiProducts();this.products={redemet:this.cappiProducts[0],cemaden:'cappi3',inea:preference('sideralIneaProduct','zh')};this.product=this.products.redemet;this.selected='all';this.renderMode=preference('sideralRadarRenderMode','pixel');this.quality=preference('sideralRadarQuality','extreme');this.exportQuality=preference('sideralRadarExportQuality','high');if(!EXPORT_PRESETS[this.exportQuality])this.exportQuality='high';this.paletteChoice=savedPalette;this.style=WXTOOLS_STYLE_ALIASES[savedPalette]||({usa:'nws',pixel:'hd_pixel'}[savedStyle]||savedStyle);if(!RADAR_STYLES[this.style]){this.style='normal';this.paletteChoice='normal'};this.opacity=Number(preference('sideralRadarOpacity','1'));this.frames=[];this.radars=[];this.redemetCatalogs=[];this.layers={lightning:false,coverage:true,track:true,states:true,municipalities:false};this.renderToken=0;this.trackToken=0;this.scrubTimer=null;this.preloadToken=0;this.scopeLayerBackup=null;this.sourceToken=0;this.initialized=false;
    this.layers.markers=true;
    // Restaura a renderização estável da REDEMET: PNG original, pixels
    // nativos e nenhum reprocessamento radial pesado no carregamento inicial.
    if(preference('sideralRadarStablePixelMigrated','0')!=='1'){
      this.renderMode='pixel';this.quality='extreme';this.style='hd_pixel';this.paletteChoice='hd_pixel';
      savePreference('sideralRadarRenderMode',this.renderMode);savePreference('sideralRadarQuality',this.quality);
      savePreference('sideralRadarStyle',this.style);savePreference('sideralRadarPaletteChoice',this.paletteChoice);
      savePreference('sideralRadarStablePixelMigrated','1');
    }
    this.providers={rainviewer:new RainViewerProvider(),redemet:new RedemetProvider(this.cache),cemaden:new CemadenProvider(),regional:new RegionalProvider(),inea:new IneaProvider(),simepar:new SimeparProvider(),ipmet:new IPMetProvider()};this.redemetProviders=new Map();
    this.map=new MapManagerFresh('radarMap',()=>{if(this.frames.length){this.render(this.animation.index,true);this.scheduleFramePreload()}if(this.radars.length)this.map.setCoverage(this.visibleRadars(),this.layers.coverage);if(this.lightningFeatures)this.map.setLightning(this.lightningFeatures,this.layers.lightning)});
    this.animation=new RadarAnimation(index=>this.render(index));
    this.ui=new RadarControlsFresh({source:v=>this.switchSource(v),product:v=>this.changeProduct(v),radar:v=>this.selectRadar(v),mode:v=>this.setRenderMode(v),quality:v=>this.setQuality(v),theme:v=>{savePreference('sideralRadarMapTheme',v);this.map.setTheme(v)},opacity:v=>this.setOpacity(v),style:v=>this.setStyle(v),view3d:v=>this.map.view3d(v),home:()=>this.map.home(),north:()=>this.map.topDown(),layer:(n,v)=>this.toggleLayer(n,v),previous:()=>this.stepFrame(-1),next:()=>this.stepFrame(1),play:()=>this.ui.playing(this.animation.toggle()),speed:v=>this.animation.setSpeed(v),frame:(v,commit)=>this.scrubFrame(v,commit),resize:()=>this.map.resize(),download:(format,progress,quality)=>this.downloadRadar(format,progress,quality)});
    this.v3=new ScopeV3(this);this.radarCatalog=[];
    const sourceSelect=document.getElementById('sourceSelect');if(sourceSelect&&![...sourceSelect.options].some(option=>option.value==='map'))sourceSelect.add(new Option('Selecione um radar no mapa','map'),0);
    this.map.setRadarPicker(marker=>void this.activateRadarMarker(marker));
  }

  isRadarScopeCappi(){return RADARSCOPE_CAPPI_MODES.has(this.renderMode)}
  scopeProfile(){return this.renderMode==='super_res'?'superres':this.renderMode==='brasil_scope_v5'?'scope5':this.renderMode==='brasil_scope_v4'?'scope4':this.renderMode==='usa_radial'||this.renderMode==='brasil_scope_v3'?'super':this.renderMode==='radarscope_v2_hd'?'scope2hd':this.renderMode==='brazil_scope'?'brazil':this.renderMode==='brazil_scope_v2'?'brazil2':this.renderMode==='sideral_hub'?'hub':'scope'}
  scopeProductFor(source=this.source){return RADARSCOPE_CAPPI_PRODUCTS[source]||null}
  isCombinedSource(source=this.source){return Object.hasOwn(COMBINED_SOURCES,source)}
  radarLongitude(radar){return Number(radar?.longitude ?? radar?.lon ?? radar?.lng ?? radar?.x)}
  radarLatitude(radar){return Number(radar?.latitude ?? radar?.lat ?? radar?.y)}
  validRadar(radar){return !!radar&&Number.isFinite(this.radarLongitude(radar))&&Number.isFinite(this.radarLatitude(radar))}
  normalizedRadar(radar){if(!radar)return radar;const longitude=this.radarLongitude(radar),latitude=this.radarLatitude(radar);return {...radar,longitude,latitude,lon:longitude,lng:longitude,lat:latitude}}
  scopeRadarCandidate(){
    const valid=this.radars.filter(radar=>this.validRadar(radar));
    if(!valid.length)return this.radars[0]||null;
    const active=valid.filter(radar=>Number(radar.imageSize)>5000);
    if(active.length)return active.reduce((best,radar)=>Number(radar.imageSize)>Number(best?.imageSize||0)?radar:best,null);
    const center=this.map.getCenter();
    return valid.reduce((best,radar)=>{
      const longitude=this.radarLongitude(radar),latitude=this.radarLatitude(radar);
      const distance=(longitude-center[0])**2+(latitude-center[1])**2;
      return !best||distance<best.distance?{radar,distance}:best;
    },null)?.radar||valid[0];
  }
  syncScopeRadarOption(){
    const select=document.getElementById('radarSelect');
    if(!select)return;
    const all=select.querySelector('option[value="all"]');
    if(all)all.disabled=false;
    if([...select.options].some(option=>option.value===this.selected))select.value=this.selected;
  }
  setLayerButtonState(name,active){
    const id={lightning:'lightningToggle',markers:'markerToggle',coverage:'coverageToggle',track:'trackToggle',states:'statesToggle',municipalities:'municipalitiesToggle'}[name],button=id?document.getElementById(id):null;
    if(!button)return;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  }
  setScopeLayers(active){
    this.map.setLightning(this.lightningFeatures||[],this.layers.lightning);
    this.map.setCoverage(this.visibleRadars(),this.layers.coverage);
    ['lightning','coverage','track'].forEach(name=>this.setLayerButtonState(name,this.layers[name]));
    if(this.layers.track&&this.lightningPoints().length)this.refreshAutomaticTracks();
  }
  focusRadarScope({fly=true}={}){
    if(!this.isRadarScopeCappi()||!this.radars.length)return null;

    if(this.selected==='all'){
      this.map.setRadarScopeMode(true,this.map.getCenter(),this.scopeProfile());
      this.syncScopeRadarOption();
      return null;
    }

    const radar=this.radars.find(item=>item.id===this.selected);
    if(!radar)return null;

    const normalized=this.normalizedRadar(radar);
    if(this.validRadar(normalized)){
      const origin=[normalized.longitude,normalized.latitude];
      this.map.setRadarScopeOrigin(origin);
      this.map.setRadarScopeMode(true,origin,this.scopeProfile());
      if(fly)this.map.flyTo({...normalized,zoom:8.1});
    }
    this.syncScopeRadarOption();
    return radar;
  }
  async init(){
    await this.map.ready;
    this.layers.states=preference('sideralRadarStatesVisible','true')!=='false';
    this.layers.markers=preference('sideralRadarMarkersVisible','true')!=='false';
    this.layers.municipalities=preference('sideralRadarMunicipalitiesVisible','true')!=='false';
    this.setLayerButtonState('markers',this.layers.markers);this.map.setLayerVisibility('radar-centers',this.layers.markers);this.setLayerButtonState('states',this.layers.states);this.setLayerButtonState('municipalities',this.layers.municipalities);
    void this.map.setBoundaries('states',this.layers.states);void this.map.setBoundaries('municipalities',this.layers.municipalities);
    const query=new URLSearchParams(location.search),requested=query.get('source'),requestedRadar=query.get('radar');
    const requestedMode=query.get('mode'),requestedQuality=query.get('quality');
    if(['standard','radiais','pixel','mirror','usa_radial','radarscope_v2_hd','brazil_scope','brazil_scope_v2','brasil_scope_v3','brasil_scope_v4','brasil_scope_v5','super_res','sideral_hub'].includes(requestedMode))this.renderMode=requestedMode;
    if(['balanced','high','ultra','extreme','supreme4k'].includes(requestedQuality))this.quality=requestedQuality;
    let initialSource=['map','all','all_no_rainviewer','rainviewer','redemet','cptec','cemaden','regional','inea','simepar','ipmet'].includes(requested)?requested:'map';
    document.getElementById('sourceSelect').value=initialSource;
    document.getElementById('productSelect').value=this.product;
    document.getElementById('renderMode').value=this.renderMode;
    document.getElementById('renderQuality').value=this.quality;
    document.getElementById('downloadQuality').value=this.exportQuality;
    {const palette=document.getElementById('paletteSelect');if(palette)palette.value=[...palette.options].some(option=>option.value===this.paletteChoice)?this.paletteChoice:this.style;}
    document.getElementById('opacityRange').value=Math.round(this.opacity*100);
    document.getElementById('opacityValue').value=`${Math.round(this.opacity*100)}%`;
    document.getElementById('mapTheme').value=preference('sideralRadarMapTheme','light');
    this.updateLegend();
    if(['radiais','pixel','mirror','usa_radial','radarscope_v2_hd','brazil_scope','brazil_scope_v2','brasil_scope_v3','brasil_scope_v4','brasil_scope_v5','super_res','sideral_hub'].includes(this.renderMode))this.setRenderMode(this.renderMode);
    else{const theme=document.getElementById('mapTheme').value;if(theme!=='light')this.map.setTheme(theme)}
    this.loadLightning();
    if(initialSource==='cptec')await this.v3.enter(this.renderMode==='brasil_scope_v5'?'scope5':this.renderMode==='brasil_scope_v4'?'scope4':null);
    else await this.switchSource(initialSource);
    if(requestedRadar&&this.radars.some(radar=>radar.id===requestedRadar))await this.selectRadar(requestedRadar);
    this.initialized=true;
    if(query.get('view')==='3d'&&!this.isRadarScopeCappi())this.ui.set3d(true);
    this.ui.loaded();
    this.refresh=setInterval(()=>this.switchSource(this.source,true),5*60*1000);
    this.lightningRefresh=setInterval(()=>this.loadLightning(),2*60*1000);
    if('serviceWorker'in navigator)navigator.serviceWorker.register('./radar-sw.js').catch(()=>{});
  }
  activeCappiProducts(){return this.cappiProducts}
  async loadRedemetProducts(){
    const selected=this.activeCappiProducts();
    const settled=await Promise.allSettled(selected.map(async product=>{let provider=this.redemetProviders.get(product);if(!provider){provider=new RedemetProvider(this.cache);this.redemetProviders.set(product,provider)}const data=await provider.load(product);return{product,provider,data}}));
    const results=settled.filter(result=>result.status==='fulfilled').map(result=>result.value);
    this.redemetCatalogs=results;
    const primary=results[0]?.data;if(!primary)throw new Error('Nenhum nível CAPPI respondeu neste momento.');
    const radars=new Map();
    results.flatMap(item=>item.data.radars||[]).forEach(radar=>{const current=radars.get(radar.id);if(!current||Number(radar.imageSize)>Number(current.imageSize))radars.set(radar.id,radar)});
    const merged=[...radars.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));return{...primary,radars:merged,availableRadars:merged.filter(radar=>radar.available!==false).length,unavailableRadars:merged.filter(radar=>radar.available===false).length};
  }
  closestProductFrame(catalog,index){
    const target=this.frames[index]?.date;if(!(target instanceof Date))return Math.min(index,catalog.data.frames.length-1);
    let best=0,difference=Infinity;catalog.data.frames.forEach((frame,frameIndex)=>{if(!(frame.date instanceof Date))return;const candidate=Math.abs(frame.date.getTime()-target.getTime());if(candidate<difference){difference=candidate;best=frameIndex}});return best;
  }
  async currentImageLayers(index,selected=this.selected){
    if(this.source!=='redemet'||!this.redemetCatalogs.length){const provider=this.providers[this.source],frame=this.frames[index];return provider.imageLayers?provider.imageLayers(index,selected,this.quality):[provider.frameLayer(frame,this.quality)]}
    const batches=await Promise.all(this.redemetCatalogs.map(async catalog=>{const frameIndex=this.closestProductFrame(catalog,index),layers=await catalog.provider.imageLayers(frameIndex,selected,this.quality);return layers.map(layer=>({...layer,id:`${layer.id}-${catalog.product}`,product:catalog.product}))}));
    return batches.flat();
  }
  async switchSource(source,refresh=false){
    if(this.exporting&&refresh)return;
    const requestToken=++this.sourceToken,previousSelected=this.selected;
    this.animation.pause();this.ui.playing(false);this.source=source;this.ui.sourceFields(source);this.setDopplerPaletteAvailability(false);
    const profile=PRODUCT_PROFILES[source]||PRODUCT_PROFILES.rainviewer;
    if(['redemet','cemaden','inea','regional'].includes(source)){const values=new Set(profile.products.map(product=>product.value));this.product=values.has(this.products[source])?this.products[source]:profile.products[0].value;this.products[source]=this.product}else this.product=profile.products[0].value;
    const scopeProduct=this.isRadarScopeCappi()&&source!=='redemet'?this.scopeProductFor(source):null;
    if(scopeProduct&&profile.products.some(product=>product.value===scopeProduct)){this.product=scopeProduct;this.products[source]=scopeProduct}
    this.ui.setProductProfile(profile,source==='redemet'?(scopeProduct?[scopeProduct]:this.cappiProducts):this.product);
    if(source==='map')return this.showRadarCatalog(refresh);
    if(this.isCombinedSource(source))return this.switchAllSources(source,refresh);
    const provider=this.providers[source];this.ui.status({title:'Atualizando…',detail:'',origin:provider.name,loading:true,link:provider.officialUrl});
    try{
      if(source!=='redemet')this.redemetCatalogs=[];
      const data=source==='redemet'?await this.loadRedemetProducts():await provider.load(['cemaden','inea','regional'].includes(source)?this.product:undefined);
      if(requestToken!==this.sourceToken||source!==this.source)return;
      this.map.clearRadar();this.frames=data.frames;this.radars=(data.radars||[]).map(radar=>({...radar,sourceId:source}));this.selected=this.radars.some(radar=>radar.id===previousSelected&&radar.available!==false)?previousSelected:'all';this.ui.setRadars(this.radars);
      let scopeRadar=null;
      if(this.isRadarScopeCappi()){
        scopeRadar=this.selected!=='all'?this.radars.find(radar=>radar.id===this.selected):this.scopeRadarCandidate();
        if(scopeRadar)this.selected=scopeRadar.id;
        this.setScopeLayers(true);
        this.map.setRadarScopeMode(true,this.map.getCenter(),this.scopeProfile());
        if(scopeRadar)this.focusRadarScope({fly:true});
        this.map.setCoverage(this.visibleRadars(),this.layers.coverage);
      }else{
        this.setScopeLayers(false);
        this.map.setCoverage(this.visibleRadars(),this.layers.coverage);
        this.updateRadarScopeOrigin();
      }
      this.syncScopeRadarOption();
      this.ui.timeline(this.frames,this.frames.length-1);
      this.ui.loaded();
      await this.animation.setFrames(this.frames.length);
      if(data.focusBounds&&!scopeRadar)this.map.fitBounds(data.focusBounds);
      this.scheduleFramePreload();
      const newest=this.frames.at(-1);const age=newest?.date?(Date.now()-newest.date.getTime())/60000:null;const delayed=Number.isFinite(age)&&age>30;const available=source==='redemet'?Number(data.availableRadars)||0:this.radars.length;const unavailable=source==='redemet'?Number(data.unavailableRadars)||0:0;
      this.ui.status({title:delayed?'Última imagem':'Radar atualizado',detail:source==='redemet'?`${available} com imagem · ${unavailable} sem imagem recente · ${this.frames.length} horários`:`${this.radars.length} radares · ${this.frames.length} imagens`,origin:provider.name,date:newest?.date,error:false,link:provider.officialUrl});
    }catch(error){if(requestToken!==this.sourceToken||source!==this.source)return;console.error(error);this.frames=[];this.radars=[];this.ui.setRadars([]);this.ui.timeline([],0);this.map.clearRadar();this.map.setCoverage([],false);this.animation.setFrames(0);this.ui.status({title:'Radar temporariamente indisponível',detail:this.errorMessage(error),origin:provider.name,error:true,link:provider.officialUrl});}finally{if(requestToken===this.sourceToken)this.ui.loaded()}
  }
  async showRadarCatalog(refresh=false){
    this.map.clearRadar();this.frames=[];this.radars=[];this.selected='all';this.ui.setRadars([]);this.ui.timeline([],0);await this.animation.setFrames(0);
    this.ui.status({title:'Carregando radares no mapa…',detail:'Consultando as redes disponíveis.',origin:'Seleção pelo mapa',loading:true});
    const entries=COMBINED_SOURCES.all_no_rainviewer.map(id=>[id,this.providers[id]]).filter(([,provider])=>provider);
    const [providerResults,cptecResult]=await Promise.all([
      Promise.allSettled(entries.map(([id,provider])=>provider.load(id==='redemet'?this.products.redemet:id==='cemaden'?this.products.cemaden:id==='inea'?this.products.inea:undefined))),
      this.v3.json('/api/radar/v3/radars').catch(()=>({radars:[]}))
    ]);
    const catalog=[];
    providerResults.forEach((result,index)=>{if(result.status!=='fulfilled')return;const sourceId=entries[index][0];for(const radar of result.value.radars||[])if(this.validRadar(radar))catalog.push({...this.normalizedRadar(radar),sourceId})});
    for(const radar of cptecResult.radars||[]){const location=CPTEC_LOCATIONS[radar.id]||CPTEC_LOCATIONS[String(radar.id).replace(/^cptec-/,'')];if(location)catalog.push({...radar,longitude:location[0],latitude:location[1],lon:location[0],lat:location[1],sourceId:'cptec',available:true})}
    const unique=new Map(catalog.map(radar=>[`${radar.sourceId}:${radar.id}`,radar]));this.radarCatalog=[...unique.values()];this.map.setRadarMarkers(this.radarCatalog);this.map.setCoverage(this.radarCatalog,this.layers.coverage);this.map.home();
    this.ui.status({title:'Escolha um radar',detail:`${this.radarCatalog.length} radares disponíveis. Clique em um ponto vermelho.`,origin:'Seleção pelo mapa',error:!this.radarCatalog.length});this.ui.loaded();
  }
  async activateRadarMarker(marker){
    const id=String(marker?.id||''),source=String(marker?.sourceId||'');if(!id||!source)return;
    this.ui.status({title:`Ligando ${marker.name||'radar'}…`,detail:'Aguarde a imagem mais recente.',origin:'Seleção pelo mapa',loading:true});
    const sourceSelect=document.getElementById('sourceSelect');
    if(source==='cptec'){
      if(sourceSelect)sourceSelect.value='cptec';await this.v3.enter();const select=document.getElementById('v3Radar');
      if(select&&[...select.options].some(option=>option.value===id)){select.value=id;await this.v3.selectRadar()}
    }else{
      if(this.v3.active)this.v3.leave({switchSource:false});if(sourceSelect)sourceSelect.value=source;await this.switchSource(source);
      if(this.radars.some(radar=>radar.id===id&&radar.available!==false))await this.selectRadar(id);
    }
    this.ui.activateTab('visual');
  }
  async switchAllSources(source=this.source,refresh=false){
    const sourceIds=COMBINED_SOURCES[source]||COMBINED_SOURCES.all;
    const entries=sourceIds.map(id=>[id,this.providers[id]]).filter(([,provider])=>provider);
    const withoutRainViewer=source==='all_no_rainviewer';
    const sourceLabel=withoutRainViewer?'REDEMET + CEMADEN + regionais + INEA + SIMEPAR + IPMet':'REDEMET + CEMADEN + regionais + INEA + SIMEPAR + IPMet + RainViewer';
    this.ui.status({title:'Carregando todos os radares…',detail:withoutRainViewer?'Consultando somente as redes de radar, sem o mosaico RainViewer.':'Consultando todas as fontes disponíveis.',origin:'Múltiplas fontes',loading:true});
    try{
      const results=await Promise.allSettled(entries.map(([id,provider])=>provider.load(id==='redemet'?this.products.redemet:id==='cemaden'?this.products.cemaden:id==='inea'?this.products.inea:undefined)));
      this.allSources=[];
      results.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value.frames?.length)this.allSources.push({id:entries[index][0],provider:entries[index][1],data:result.value})});
      if(!this.allSources.length)throw new Error('Nenhuma fonte forneceu imagem de radar neste momento.');
      this.radars=this.allSources.flatMap(item=>(item.data.radars||[]).map(radar=>({...radar,sourceId:item.id})));this.selected='all';this.ui.setRadars(this.radars);this.map.setCoverage(this.radars,this.layers.coverage);
      const dates=this.allSources.map(item=>item.data.frames.at(-1)?.date).filter(date=>date instanceof Date&&!Number.isNaN(date.getTime()));
      const newest=dates.length?new Date(Math.max(...dates.map(date=>date.getTime()))):new Date();
      this.frames=[{date:newest}];this.ui.loaded();await this.animation.setFrames(1);this.map.home();
      const failed=results.filter(result=>result.status==='rejected').length;
      this.ui.status({title:'Radares atualizados',detail:`Imagens de ${this.allSources.length} ${this.allSources.length===1?'fonte':'fontes'} e ${this.radars.length} ${this.radars.length===1?'radar':'radares'}.${failed?` ${failed} ${failed===1?'fonte não respondeu':'fontes não responderam'} no momento.`:''}${refresh?' Atualização concluída.':''}`,origin:sourceLabel,date:newest,error:false});
    }catch(error){console.error(error);this.frames=[];this.radars=[];this.allSources=[];this.map.clearRadar();this.map.setCoverage([],false);this.animation.setFrames(0);this.ui.status({title:'Radares temporariamente indisponíveis',detail:this.errorMessage(error),origin:'Múltiplas fontes',error:true})}finally{this.ui.loaded()}
  }
  errorMessage(error){if(error?.name==='AbortError')return'A consulta demorou mais que o esperado. Tente novamente.';if(/proxy|servidor local|localStorage/i.test(error?.message||''))return'Esta fonte não está disponível no momento. Tente novamente mais tarde.';return error?.message||'Não foi possível atualizar o radar agora.'}
  stepFrame(offset){this.animation.pause();this.ui.playing(false);clearTimeout(this.scrubTimer);return this.animation.go(this.animation.index+offset)}
  scrubFrame(index,commit=false){
    if(!this.frames.length)return;this.animation.pause();this.ui.playing(false);const target=Math.max(0,Math.min(this.frames.length-1,Number(index)||0));this.animation.index=target;this.ui.frame(target,this.frames[target]?.date);clearTimeout(this.scrubTimer);this.scrubTimer=setTimeout(()=>this.animation.go(target),commit?0:70);
  }
  scheduleFramePreload(){
    const token=++this.preloadToken;clearTimeout(this.preloadTimer);this.preloadPromise=null;if(this.isCombinedSource()||this.frames.length<2)return;
    if(this.selected==='all'&&this.source!=='rainviewer'&&this.radars.length>4)return;
    this.preloadPromise=new Promise(resolve=>{this.preloadTimer=setTimeout(async()=>{
      if(token!==this.preloadToken){resolve(false);return}
      try{
        const provider=this.providers[this.source],current=this.animation.index,count=this.source==='rainviewer'?this.frames.length:Math.min(4,this.frames.length),indexes=[];
        for(let offset=1;indexes.length<count&&offset<=this.frames.length;offset++){for(const candidate of [(current+offset)%this.frames.length,(current-offset+this.frames.length)%this.frames.length])if(!indexes.includes(candidate)&&candidate!==current&&indexes.length<count)indexes.push(candidate)}
        const batches=await Promise.all(indexes.map(async frameIndex=>{const frame=this.frames[frameIndex],produced=await this.currentImageLayers(frameIndex,this.selected);return produced.filter(Boolean).map(layer=>this.processedLayer(layer,this.source,frame?.time??frameIndex))}));
        if(token!==this.preloadToken){resolve(false);return}
        const loaded=await this.map.preloadRadarLayers(batches.flat());resolve(token===this.preloadToken&&loaded);
      }catch(error){console.warn('Pré-carregamento do radar indisponível:',error);resolve(false)}
    },80)});
  }
  processedLayer(layer,source,frameKey){
    if(!layer)return layer;
    if(layer.precomputed&&layer.originalLayer&&(this.renderMode==='radiais'||this.isRadarScopeCappi())){
      layer={...layer,...layer.originalLayer,precomputed:false,nativePixels:false,preserveColors:false};
    }
    const radar=this.normalizedRadar(layer.radar),originArray=this.validRadar(radar)?[radar.longitude,radar.latitude]:this.radarScopeOrigin(),origin=originArray.map(value=>Number(value).toFixed(4)).join(',');
    // CEMADEN image tiles are already colorized PNGs; keep them native so
    // switching from a polar CPTEC mode cannot turn the layer black.
    const sourceKey=layer.cacheKey||layer.url||layer.tiles?.join('|')||layer.id||frameKey,scope=this.isRadarScopeCappi()&&this.source!=='cemaden';
    return {...layer,
      radar,
      cacheKey:`${source}:${sourceKey}:${this.quality}:${this.renderMode}:${this.paletteChoice}:${origin}:crisp5`,
      // Pixelização polar com fila limitada e retorno automático para a
      // imagem original caso o aparelho não consiga processar uma varredura.
      nativePixels:Boolean(layer.nativePixels),
      preserveColors:layer.preserveColors,
      pixelated:scope?true:layer.pixelated,
      smoothing:scope?false:layer.smoothing,
      interpolation:scope?'nearest':layer.interpolation,
      resampling:scope?'nearest':layer.resampling,
      rasterResampling:scope?'nearest':layer.rasterResampling,
      nativeCappi:false,
      radarScope:scope,
      radarScopeMode:scope?this.scopeProfile():undefined,
      radarScopeOrigin:scope?originArray:layer.radarScopeOrigin
    };
  }
  async render(index,fromStyleReload=false){const frame=this.frames[index];if(!frame)return false;if(this.isCombinedSource())return this.renderAll(index,fromStyleReload);const token=++this.renderToken,provider=this.providers[this.source];let layers=[];try{this.map.setRadarStyle(this.style,this.opacity);layers=await this.currentImageLayers(index,this.selected);layers=layers.filter(Boolean).map(layer=>this.processedLayer(layer,this.source,frame.time??index));if(token!==this.renderToken)return false;const options=this.exporting?{timeout:12000,requireLoaded:true,retain:this.source==='rainviewer'}:{retain:this.source==='rainviewer'};await this.map.replaceRadar(layers,this.exporting?0:90,options);if(token!==this.renderToken)return false;this.map.setRadarStyle(this.style,this.opacity);this.ui.frame(index,frame.date);this.animation.index=index;if(provider.imageLayers&&!layers.length)this.ui.status({title:'Imagem não disponível',detail:'Não há uma imagem válida para este horário.',origin:provider.name,date:frame.date,error:true,link:provider.officialUrl});return true}catch(error){if(!fromStyleReload)this.ui.status({title:'Não foi possível exibir a imagem',detail:this.errorMessage(error),origin:provider.name,date:frame.date,error:true,link:provider.officialUrl});if(this.exporting)throw error;return false}}
  async renderAll(index,fromStyleReload=false){const token=++this.renderToken;const layers=[];this.map.setRadarStyle(this.style,this.opacity);for(const item of this.allSources||[]){try{const frameIndex=Math.max(0,item.data.frames.length-1),frame=item.data.frames[frameIndex];const produced=item.provider.imageLayers?await item.provider.imageLayers(frameIndex,'all',this.quality):[item.provider.frameLayer(frame,this.quality)];produced.filter(Boolean).forEach(layer=>layers.push({...this.processedLayer(layer,item.id,frame?.time??frameIndex),keepView:true}))}catch(error){console.warn(`Fonte ${item.id} não pôde ser desenhada:`,error)}}if(token!==this.renderToken)return false;await this.map.replaceRadar(layers,this.exporting?0:220,this.exporting?{timeout:12000,requireLoaded:true}:undefined);if(token!==this.renderToken)return false;this.map.setRadarStyle(this.style,this.opacity);this.ui.frame(0,this.frames[0]?.date);this.animation.index=0;if(!layers.length&&!fromStyleReload)this.ui.status({title:'Sem imagens disponíveis',detail:'As fontes responderam, mas nenhum quadro pôde ser desenhado.',origin:'Múltiplas fontes',error:true});return true}
  visibleRadars(){return this.selected==='all'?this.radars:this.radars.filter(r=>r.id===this.selected)}
  radarScopeOrigin(){const selected=this.radars.find(r=>r.id===this.selected);if(this.validRadar(selected))return [this.radarLongitude(selected),this.radarLatitude(selected)];const center=this.map.getCenter(),valid=this.radars.filter(r=>this.validRadar(r));if(!valid.length)return center;const nearest=valid.reduce((best,radar)=>{const distance=(this.radarLongitude(radar)-center[0])**2+(this.radarLatitude(radar)-center[1])**2;return !best||distance<best.distance?{radar,distance}:best},null)?.radar;return nearest?[this.radarLongitude(nearest),this.radarLatitude(nearest)]:center}
  updateRadarScopeOrigin(){this.map.setRadarScopeOrigin(this.radarScopeOrigin())}
  async selectRadar(id){
    if(id!=='all'&&!this.radars.some(radar=>radar.id===id&&radar.available!==false))return;
    this.selected=id;
    this.updateRadarScopeOrigin();

    const radar=this.radars.find(r=>r.id===id);

    if(this.isRadarScopeCappi()){
      this.setScopeLayers(true);
      if(id==='all'){
        this.map.setRadarScopeMode(true,this.map.getCenter(),this.scopeProfile());
        this.map.setCoverage(this.radars,this.layers.coverage);
      }else{
        this.focusRadarScope({fly:true});
        this.map.setCoverage(this.visibleRadars(),this.layers.coverage);
      }
    }else{
      this.map.setCoverage(this.visibleRadars(),this.layers.coverage);
      if(radar)this.map.flyTo(radar);
    }

    this.syncScopeRadarOption();
    const provider=this.providers[this.source],providerName=provider?.name||'Múltiplas fontes';
    this.ui.status({
      title:radar?radar.name:'Todos os radares',
      detail:'',
      origin:providerName,
      date:this.frames[this.animation.index]?.date,
      loading:true
    });

    await this.render(this.animation.index);

    this.ui.status({
      title:radar?radar.name:'Todos os radares',
      detail:'',
      origin:providerName,
      date:this.frames[this.animation.index]?.date,
      error:false
    });
  }
  async changeProduct(value){
    if(!['redemet','cemaden','inea'].includes(this.source))return;
    const forced=this.isRadarScopeCappi()&&this.source!=='redemet'?this.scopeProductFor(this.source):null;
    if(this.source==='redemet'){
      const requested=(Array.isArray(value)?value:[value]).filter(product=>REDEMET_PRODUCTS.has(product));
      this.cappiProducts=forced?[forced]:(requested.length?[...new Set(requested)]:['03km']);
      this.product=this.cappiProducts[0];this.products.redemet=this.product;
      if(!forced){savePreference('sideralRadarCappiProducts',JSON.stringify(this.cappiProducts));savePreference('sideralRadarProduct',this.product)}
      await this.switchSource(this.source);return;
    }
    this.product=forced||value;this.products[this.source]=this.product;
    if(this.source!=='cemaden')savePreference(this.source==='inea'?'sideralIneaProduct':'sideralRadarProduct',this.product);
    await this.switchSource(this.source);
  }
  setRenderMode(value){
    this.renderMode=['radiais','pixel','mirror','usa_radial','radarscope_v2_hd','brazil_scope','brazil_scope_v2','brasil_scope_v3','brasil_scope_v4','brasil_scope_v5','super_res','sideral_hub'].includes(value)?value:'standard';savePreference('sideralRadarRenderMode',this.renderMode);
    const presets={standard:{style:'normal',quality:'balanced',opacity:.8,theme:'light'},radiais:{style:'wx_radiais',quality:'extreme',opacity:1,theme:'satellite'},pixel:{style:'hd_pixel',quality:'extreme',opacity:1,theme:'satellite'},mirror:{style:'wx_nssl_iii',quality:'extreme',opacity:1,theme:'satellite'},usa_radial:{style:'wx_radarscope',quality:'extreme',opacity:1,theme:'satellite'},radarscope_v2_hd:{style:'wx_radarscope_v2_hd',quality:'extreme',opacity:1,theme:'satellite'},brazil_scope:{style:'wx_radarscope',quality:'extreme',opacity:1,theme:'satellite'},brazil_scope_v2:{style:'wx_radarscope',quality:'extreme',opacity:1,theme:'satellite'},brasil_scope_v3:{style:'wx_radarscope',quality:'extreme',opacity:1,theme:'satellite'},brasil_scope_v4:{style:'wx_scope4',quality:'extreme',opacity:1,theme:'satellite'},brasil_scope_v5:{style:'wx_scope5',quality:'extreme',opacity:1,theme:'satellite'},super_res:{style:'wx_scope5',quality:'extreme',opacity:1,theme:'satellite'},sideral_hub:{style:'wx_radarscope',quality:'extreme',opacity:1,theme:'satellite'}};
    let settings=presets[this.renderMode],scope=this.isRadarScopeCappi();
    if(this.quality==='supreme4k'&&settings.quality==='extreme')settings={...settings,quality:'supreme4k'};
    this.style=settings.style;this.quality=settings.quality;this.opacity=settings.opacity;
    this.map.setDisplayQuality(this.quality);
    savePreference('sideralRadarStyle',this.style);savePreference('sideralRadarQuality',this.quality);savePreference('sideralRadarOpacity',String(this.opacity));savePreference('sideralRadarMapTheme',settings.theme);
    this.paletteChoice=this.renderMode==='radiais'?'wx_radiais':this.renderMode==='radarscope_v2_hd'?'wx_radarscope_v2_hd':this.renderMode==='usa_radial'||this.renderMode==='brazil_scope'||this.renderMode==='brazil_scope_v2'||this.renderMode==='sideral_hub'?'wx_radarscope':this.renderMode==='mirror'?'wx_nssl_iii':this.style;savePreference('sideralRadarPaletteChoice',this.paletteChoice);document.getElementById('renderMode').value=this.renderMode;{const palette=document.getElementById('paletteSelect');if(palette)palette.value=[...palette.options].some(option=>option.value===this.paletteChoice)?this.paletteChoice:this.style;}document.getElementById('renderQuality').value=this.quality;document.getElementById('opacityRange').value=Math.round(this.opacity*100);document.getElementById('opacityValue').value=`${Math.round(this.opacity*100)}%`;document.getElementById('mapTheme').value=settings.theme;
    // Modo visual RadarScope: radialização corrigida, limitada somente à área real dos ecos.
    this.map.setRadarScopeMode(scope,this.radarScopeOrigin(),this.scopeProfile());
    if(this.initialized||this.radars.length)this.setScopeLayers(scope);this.syncScopeRadarOption();
    if(scope&&this.radars.length){
      if(this.selected==='all')this.selected=this.scopeRadarCandidate()?.id||'all';
      if(this.selected!=='all')this.focusRadarScope({fly:true});
    }
    this.updateLegend();this.ui.set3d(false);this.map.setTheme(settings.theme);
    if(this.initialized&&scope&&(this.source==='rainviewer'||this.source==='all')){
      const sourceSelect=document.getElementById('sourceSelect');
      if(sourceSelect)sourceSelect.value=RADARSCOPE_PREFERRED_SOURCE;
      void this.switchSource(RADARSCOPE_PREFERRED_SOURCE);
      return;
    }
    if(this.initialized&&this.source==='redemet'){void this.switchSource('redemet');return}
    if(this.frames.length&&this.map.map.isStyleLoaded())void this.render(this.animation.index);
  }
  setQuality(value){this.quality=value;savePreference('sideralRadarQuality',value);this.map.setDisplayQuality(value);this.render(this.animation.index);this.scheduleFramePreload()}
  setStyle(value){
    const palette=document.getElementById('paletteSelect');
    const resolved=WXTOOLS_STYLE_ALIASES[value]||value;
    this.paletteChoice=value;
    this.style=RADAR_STYLES[resolved]?resolved:'normal';
    savePreference('sideralRadarPaletteChoice',this.paletteChoice);savePreference('sideralRadarStyle',this.style);
    this.map.setRadarStyle(this.style,this.opacity);this.updateLegend();if(this.frames.length)void this.render(this.animation.index);
    const help=document.getElementById('paletteHelp');if(help)help.textContent='';
  }
  setDopplerPaletteAvailability(enabled){
    // As paletas WxTools permanecem liberadas para qualquer fonte/produto.
    this.dopplerPalettesEnabled=Boolean(enabled);
  }
  updateLegend(){
    const style=RADAR_STYLES[this.style]||RADAR_STYLES.normal,legend=document.querySelector('.dbz-scale');
    if(legend)legend.style.background=style.gradient||RADAR_STYLES.normal.gradient;
    const title=document.querySelector('.dbz-legend strong');
    if(title)title.textContent=style.wxProduct==='BV'?`BV (${style.units||'KTS'}) · visual`:style.wxProduct==='CC'?`CC (${style.units||'RHO'}) · visual`:'dBZ';
    const values=document.querySelectorAll('.dbz-values span');
    const labels=style.wxProduct==='BV'?['-120','-50','0','30','60','120']:style.wxProduct==='CC'?['0','0,6','0,8','0,9','1,0','1,05']:['5','20','35','50','65','70+'];
    values.forEach((element,index)=>{if(labels[index]!=null)element.textContent=labels[index]});
  }
  setOpacity(value){this.opacity=value;savePreference('sideralRadarOpacity',value);this.map.setOpacity(value)}
  toggleLayer(name,visible){
    this.layers[name]=visible;
    if(name==='markers'){savePreference('sideralRadarMarkersVisible',String(visible));this.map.setLayerVisibility('radar-centers',visible);return}
    if(name==='coverage'){this.map.setLayerVisibility('radar-coverage',visible);this.map.setLayerVisibility('radar-coverage-line',visible);return}
    if(name==='lightning'){this.map.setLayerVisibility('lightning',visible);return}
    if(name==='states'||name==='municipalities'){savePreference(`sideralRadar${name[0].toUpperCase()+name.slice(1)}Visible`,String(visible));void this.map.setBoundaries(name,visible);return}
    if(name==='track'){
      this.trackToken++;
      this.map.setStormTrackPicker(false,null);
      if(!visible){this.map.clearStormTrack();this.ui.status({title:'Trajetos ocultados',detail:'Ative a camada para recalcular as rotas das células mais ativas.',origin:'Radar'})}
      else this.refreshAutomaticTracks();
    }
  }
  lightningPoints(){return Array.isArray(this.lightningFeatures)?this.lightningFeatures:(Array.isArray(this.lightningFeatures?.features)?this.lightningFeatures.features:[])}
  automaticStormSeeds(){const bounds=this.map.getBounds(),latest=this.lightningFeatures?.snapshots?.[0],source=Array.isArray(latest)&&latest.length?latest.map(point=>[point.longitude,point.latitude]):this.lightningPoints().filter(feature=>Number(feature.properties?.ageMinutes)<5).map(feature=>feature.geometry?.coordinates),points=source.filter(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&point[0]>=bounds.west&&point[0]<=bounds.east&&point[1]>=bounds.south&&point[1]<=bounds.north),clusters=new Map();for(const [longitude,latitude] of points){const key=`${Math.round(longitude/.75)}:${Math.round(latitude/.6)}`,cluster=clusters.get(key)||{longitude:0,latitude:0,count:0};cluster.longitude+=longitude;cluster.latitude+=latitude;cluster.count++;clusters.set(key,cluster)}return [...clusters.values()].map(cluster=>({lng:cluster.longitude/cluster.count,lat:cluster.latitude/cluster.count,activity:cluster.count})).sort((a,b)=>b.activity-a.activity).slice(0,8)}
  coreMotion(seed){const snapshots=this.lightningFeatures?.snapshots;if(!Array.isArray(snapshots)||snapshots.length<2)return null;const current=[seed.lng,seed.lat],near=(points,maxKm)=>{const selected=points.filter(point=>this.coreDistanceKm(current,[point.longitude,point.latitude])<=maxKm);if(!selected.length)return null;return [selected.reduce((sum,p)=>sum+p.longitude,0)/selected.length,selected.reduce((sum,p)=>sum+p.latitude,0)/selected.length]};let previous=null,previousIndex=0;for(let index=1;index<Math.min(snapshots.length,5)&&!previous;index++){previous=near(snapshots[index],140);if(previous)previousIndex=index}if(!previous)return null;const distance=this.coreDistanceKm(previous,current);if(!Number.isFinite(distance)||distance<1)return null;const bearing=this.coreBearing(previous,current),intervalMinutes=(Number(this.lightningFeatures?.snapshotIntervalMinutes)||5)*Math.max(1,previousIndex),speedKt=distance/(intervalMinutes/60)/1.852;if(speedKt<2||speedKt>180)return null;return {bearing,speed:speedKt,method:'Deslocamento observado do núcleo GLM',distanceKm:distance,intervalMinutes}}
  coreDistanceKm(a,b){const rad=Math.PI/180,dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad,lat1=a[1]*rad,lat2=b[1]*rad;const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))}
  coreBearing(a,b){const rad=Math.PI/180,y=Math.sin((b[0]-a[0])*rad)*Math.cos(b[1]*rad),x=Math.cos(a[1]*rad)*Math.sin(b[1]*rad)-Math.sin(a[1]*rad)*Math.cos(b[1]*rad)*Math.cos((b[0]-a[0])*rad);return (Math.atan2(y,x)*180/Math.PI+360)%360}
  async refreshAutomaticTracks(){if(!this.layers.track)return;const token=++this.trackToken,seeds=this.automaticStormSeeds();if(!seeds.length){this.map.clearStormTrack();this.ui.status({title:'Sem células elétricas visíveis',detail:'Os trajetos aparecerão quando houver núcleos observados na área do mapa.',origin:'GLM / GOES-East'});return}const tracks=seeds.map(seed=>{const motion=this.coreMotion(seed);return motion?{origin:[seed.lng,seed.lat],bearingDeg:motion.bearing,speedKt:motion.speed,details:{method:motion.method,activity:seed.activity,intervalMinutes:motion.intervalMinutes}}:null}).filter(Boolean);if(token!==this.trackToken||!this.layers.track)return;if(!tracks.length){this.map.clearStormTrack();this.ui.status({title:'Núcleo sem deslocamento observado',detail:'Aguarde uma nova observação GLM para estimar a direção e a velocidade da célula.',origin:'GLM / GOES-East'});return}tracks.sort((a,b)=>(b.details.activity||0)-(a.details.activity||0));this.map.setStormTracks(tracks);this.ui.status({title:'Trajetos por núcleo ativos',detail:`${tracks.length} ${tracks.length===1?'célula acompanhada':'células acompanhadas'} · deslocamento observado nas últimas varreduras.`,origin:'GLM / GOES-East',date:this.frames[this.animation.index]?.date})}
  async createStormTrack({lng,lat}){
    const token=++this.trackToken;
    this.ui.status({title:'Calculando o trajeto…',detail:'Comparando a posição do núcleo nas últimas varreduras.',origin:'GLM / GOES-East',loading:true});
    try{
      const seed={lng,lat},motion=this.coreMotion(seed);
      if(token!==this.trackToken||!this.layers.track)return;
      if(!motion)throw new Error('Ainda não há deslocamento observado suficiente para esta célula.');
      this.map.setStormTrack([lng,lat],motion.bearing,motion.speed,{method:motion.method,intervalMinutes:motion.intervalMinutes});
      this.ui.status({title:'Trajeto do núcleo da célula',detail:`Linha de 60 min · ${Math.round(motion.speed)} kt · direção observada nas últimas varreduras.`,origin:'GLM / GOES-East',date:this.frames[this.animation.index]?.date});
    }catch(error){if(token!==this.trackToken)return;this.map.clearStormTrack();this.ui.status({title:'Trajeto indisponível',detail:error.message||'Não foi possível calcular o deslocamento observado.',origin:'GLM / GOES-East',error:true})}
  }
  downloadCurrentImage(exportQuality=this.exportQuality){
    this.exportQuality=EXPORT_PRESETS[exportQuality]?exportQuality:'high';savePreference('sideralRadarExportQuality',this.exportQuality);
    const preset=EXPORT_PRESETS[this.exportQuality],date=this.frames[this.animation.index]?.date||new Date(),stamp=date.toISOString().replace(/[:.]/g,'-'),radar=this.selected==='all'?'todos':this.selected;
    return this.map.downloadPng(`sideral-radar-${this.source}-${radar}-${stamp}.png`,{pixelRatio:preset.pixelRatio,maxWidth:preset.pngWidth,maxHeight:preset.pngHeight});
  }
  async downloadRadar(format='png',progress=()=>{},exportQuality=this.exportQuality){
    this.exportQuality=EXPORT_PRESETS[exportQuality]?exportQuality:'high';savePreference('sideralRadarExportQuality',this.exportQuality);
    return format==='gif'?this.downloadAnimatedGif(progress,this.exportQuality):this.downloadCurrentImage(this.exportQuality);
  }
  async downloadAnimatedGif(progress=()=>{},exportQuality=this.exportQuality){
    if(!this.frames.length)throw new Error('Não há quadros disponíveis para exportar.');
    if(this.exporting)throw new Error('A exportação do GIF já está em andamento.');
    this.animation.pause();this.ui.playing(false);this.exporting=true;this.ui.exporting(true);
    const restoreIndex=this.animation.index,preset=EXPORT_PRESETS[exportQuality]||EXPORT_PRESETS.high;
    const delay=Math.max(120,Math.round(900/this.animation.speed));
    const maxWidth=preset.gifWidth,maxHeight=preset.gifHeight;
    let encoder,width=0,height=0,restoreResolution=async()=>{};
    try{
      restoreResolution=await this.map.useExportResolution(preset.pixelRatio);
      for(let index=0;index<this.frames.length;index++){
        const rendered=await this.render(index);if(!rendered)throw new Error('Um quadro foi interrompido antes da captura. Tente novamente.');
        const frame=await this.map.captureFrame(maxWidth,maxHeight);
        if(!encoder){width=frame.width;height=frame.height;encoder=new GifEncoder(width,height,{delay,loop:0})}
        else if(frame.width!==width||frame.height!==height)throw new Error('A tela mudou de tamanho durante a exportação. Mantenha o aparelho na mesma orientação e tente novamente.');
        encoder.addFrame(frame.data,delay);
        progress(index+1,this.frames.length);
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      const blob=encoder.finish();if(blob.size<1024)throw new Error('O GIF gerado ficou vazio.');
      const date=this.frames.at(-1)?.date||new Date();
      const stamp=date.toISOString().replace(/[:.]/g,'-');
      const radar=this.selected==='all'?'todos':this.selected;
      this.map.downloadBlob(blob,`sideral-radar-${this.source}-${radar}-${stamp}.gif`);
    }finally{
      try{await restoreResolution()}catch(error){console.warn('Não foi possível restaurar a resolução do mapa:',error)}
      this.exporting=false;this.ui.exporting(false);
      await this.render(restoreIndex);
    }
  }
  async loadLightningLegacy(){try{this.lightningFeatures=await this.providers.redemet.lightning();this.map.setLightning(this.lightningFeatures,this.layers.lightning);if(this.layers.track&&this.lightningPoints().length)this.refreshAutomaticTracks();const b=document.getElementById('lightningToggle'),status=document.getElementById('lightningStatus'),observedAt=this.lightningFeatures?.observedAt;if(b)b.title='Raios STSC — REDEMET';if(status){if(observedAt){const stamp=new Date(observedAt).toLocaleString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});status.textContent=`REDEMET — STSC · ${stamp} UTC`}else status.textContent='REDEMET — STSC'}}catch(error){console.warn('Raios STSC indisponíveis:',error);this.lightningFeatures=[];this.map.setLightning([],false);this.map.clearStormTrack();const b=document.getElementById('lightningToggle'),status=document.getElementById('lightningStatus');if(b){b.classList.remove('active');b.setAttribute('aria-pressed','false');b.title='Raios temporariamente indisponíveis'}if(status)status.textContent='Raios temporariamente indisponíveis'}}
  async loadLightning(){
    try{
      const payload=await fetchJson(`${proxyBase()}/api/glm/lightning?ts=${Date.now()}`,{},45000);
      if(!payload?.status||!Array.isArray(payload?.points))throw new Error('A NOAA não retornou descargas GLM válidas.');
      const features=(Array.isArray(payload?.points)?payload.points:[]).map(point=>{const latitude=Number(point?.lat),longitude=Number(point?.lon),ageMinutes=Number(point?.ageMinutes);return[latitude,longitude,ageMinutes].every(Number.isFinite)?{type:'Feature',properties:{provider:'NOAA / GOES-East',source:'GLM',kind:'lightning',ageMinutes},geometry:{type:'Point',coordinates:[longitude,latitude]}}:null}).filter(Boolean);
      const snapshotMinutes=5,bucketCount=Math.max(3,Math.ceil((Number(payload.windowMinutes)||15)/snapshotMinutes)),snapshots=Array.from({length:bucketCount},()=>[]);
      for(const feature of features){const age=Number(feature.properties.ageMinutes),bucket=Math.min(bucketCount-1,Math.max(0,Math.floor(age/snapshotMinutes))),[longitude,latitude]=feature.geometry.coordinates;snapshots[bucket].push({longitude,latitude,ageMinutes:age})}
      features.observedAt=payload?.observedAt||null;features.provider='NOAA / GOES-East';features.kind='glm';features.snapshots=snapshots;features.snapshotIntervalMinutes=snapshotMinutes;this.lightningFeatures=features;this.map.setLightning(features,this.layers.lightning);
      if(this.layers.track&&snapshots[0].length)this.refreshAutomaticTracks();
      const button=document.getElementById('lightningToggle'),status=document.getElementById('lightningStatus');if(button)button.title='Raios GLM — GOES-East / NOAA';if(status)status.textContent=features.observedAt?`GOES-East — GLM · ${new Date(features.observedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'GOES-East — GLM';
    }catch(error){console.warn('Raios GLM indisponíveis:',error);const previous=this.lightningPoints(),hasPrevious=previous.length>0;if(!hasPrevious){this.lightningFeatures=[];this.map.setLightning([],false);this.map.clearStormTrack()}const button=document.getElementById('lightningToggle'),status=document.getElementById('lightningStatus');if(button)button.title=hasPrevious?'Raios GLM — mantendo a última leitura válida':'Raios GLM temporariamente indisponíveis';if(status)status.textContent=hasPrevious?'GOES-East — GLM · última leitura mantida':'Raios GLM temporariamente indisponíveis'}
  }
  destroy(){clearInterval(this.refresh);clearInterval(this.lightningRefresh);clearTimeout(this.scrubTimer);clearTimeout(this.preloadTimer);this.animation.destroy()}
}
