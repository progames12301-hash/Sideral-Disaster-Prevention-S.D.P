const makeStyle=(contrast,saturation,hue,brightnessMin,brightnessMax,gradient,meta={})=>({
  contrast,saturation,hue,brightnessMin,brightnessMax,resampling:'nearest',gradient,...meta
});

export const RADAR_STYLES=Object.freeze({
  wx_scope5:makeStyle(0,0,0,0,1,
    'linear-gradient(90deg,#60a8e0,#68d8f0,#10d828,#08c818,#08b808,#089808,#087808,#78a808,#f8e808,#f8c808,#ff8800,#f83008,#e00000,#ffffff)',
    {wxProduct:'BR',units:'dBZ',label:'Brasil Scope V5 · PPI polar',directColors:true}),
  wx_scope4:makeStyle(0,0,0,0,1,
    'linear-gradient(90deg,#5979ad,#79bdd8,#80dbe5,#00ef00,#00bb00,#008300,#ffff00,#ffb500,#ff7300,#ff0000,#b00000,#790000,#ffa7e9,#fff0ff)',
    {wxProduct:'BR',units:'dBZ',label:'Brasil Scope V4',directColors:true}),
  normal:makeStyle(.08,.12,0,0,1,'linear-gradient(90deg,#88d8f7,#1b66d2,#22b449,#f2e730,#f28c20,#e52a21,#a50b78,#eee)'),
  satellite_vivid:makeStyle(.38,.58,0,0,1,'linear-gradient(90deg,#00e5ff,#087eff,#00d85a,#00a83a,#fff000,#ff9d00,#f52b18,#c00054,#e000ff)'),
  nws:makeStyle(.3,.3,0,.02,.98,'linear-gradient(90deg,#04e9e7,#019ff4,#0300f4,#02fd02,#01c501,#008e00,#fefe00,#fd9500,#fd0000,#bc0000,#f800fd,#9854c6)'),
  nws_enhanced:makeStyle(.48,.5,0,.01,.99,'linear-gradient(90deg,#00ffff,#0077ff,#001eff,#00ff32,#00a519,#ffff00,#ff9a00,#ff1800,#b00000,#ff00ff,#7c3aed)'),
  mobile:makeStyle(.38,.62,4,.02,.99,'linear-gradient(90deg,#00dfff,#1864ff,#00e83a,#8cff00,#ffe600,#ff8500,#f40000,#a9004f,#e500ff)'),
  usa_mirror:makeStyle(.58,.68,0,0,1,'linear-gradient(90deg,#00e5ff,#009dff,#004cff,#00e541,#00a82d,#ffff00,#ff9b00,#ff2300,#c60000,#ff00d4,#9b59d0)'),
  classic:{contrast:.18,saturation:.22,hue:0,brightnessMin:.03,brightnessMax:.97,resampling:'linear',gradient:'linear-gradient(90deg,#79c9ef,#2465bd,#35aa56,#e7dc34,#e88d24,#d7352e,#8a1c79)'},
  hd_pixel:makeStyle(.12,.15,0,0,1,'linear-gradient(90deg,#88d8f7,#1b66d2,#22b449,#f2e730,#f28c20,#e52a21,#a50b78)'),
  tropical:makeStyle(.3,.7,22,.02,1,'linear-gradient(90deg,#00e5ff,#008cff,#00d66b,#baff00,#fff000,#ff9d00,#ff2d00,#d00070)'),
  ocean:{contrast:.25,saturation:.4,hue:155,brightnessMin:.02,brightnessMax:.98,resampling:'linear',gradient:'linear-gradient(90deg,#d9ffff,#55d8e8,#168aad,#184e77,#6930c3,#b5179e,#f72585)'},
  plasma:makeStyle(.35,.55,280,.02,.98,'linear-gradient(90deg,#240046,#5a189a,#9d4edd,#e0aaff,#ff6d00,#ffba08,#fff3b0)'),
  magma:makeStyle(.4,.35,320,.01,.97,'linear-gradient(90deg,#09000d,#3b0f70,#8c2981,#de4968,#fe9f6d,#fcfdbf)'),
  infrared:makeStyle(.5,-.15,210,.02,.98,'linear-gradient(90deg,#000,#2d1b69,#7b2cbf,#e5383b,#ff9f1c,#fff3b0,#fff)'),
  grayscale:{contrast:.45,saturation:-1,hue:0,brightnessMin:.03,brightnessMax:.98,resampling:'linear',gradient:'linear-gradient(90deg,#111,#444,#777,#aaa,#ddd,#fff)'},
  ice:{contrast:.3,saturation:.18,hue:170,brightnessMin:.03,brightnessMax:.99,resampling:'linear',gradient:'linear-gradient(90deg,#edfaff,#bde0fe,#48cae4,#0096c7,#023e8a,#7209b7)'},
  fire:makeStyle(.5,.65,330,.01,.98,'linear-gradient(90deg,#2b0000,#7f0000,#d00000,#ff5400,#ffbd00,#fff200,#fff)'),
  colorblind:makeStyle(.34,.18,8,.02,.99,'linear-gradient(90deg,#56b4e9,#0072b2,#009e73,#f0e442,#e69f00,#d55e00,#cc79a7)'),
  deuteranopia:makeStyle(.3,-.2,18,.03,.98,'linear-gradient(90deg,#65c5ff,#0057b8,#f5df4d,#f28e2b,#b33c2e,#7a5195)'),
  pastel:{contrast:-.05,saturation:-.25,hue:0,brightnessMin:.08,brightnessMax:1,resampling:'linear',gradient:'linear-gradient(90deg,#cdeffd,#a8c7fa,#b9e4c9,#fff1a8,#ffc98b,#f6a6a6,#d7b5e8)'},
  storm:makeStyle(.55,.28,345,0,.94,'linear-gradient(90deg,#071952,#0b666a,#35a29f,#f8de22,#f94c10,#c70039,#900c3f)'),
  high_contrast:makeStyle(.75,.75,0,0,1,'linear-gradient(90deg,#00ffff,#0000ff,#00ff00,#ffff00,#ff8000,#ff0000,#800000,#ff00ff,#fff)'),

  // WxTools — refletividade. Gradientes baseados nas tabelas publicadas pelo WxTools.
  wx_radarscope:makeStyle(.62,.72,0,0,1,
    'linear-gradient(90deg,#1d253c 0%,#599bab 18%,#21ba48 26%,#056501 38%,#fbfc00 45%,#fd9502 53%,#fd2600 63%,#871f16 69%,#c194b3 76%,#c81777 82%,#a502d7 88%,#87fffd 94%,#ad6340 97%,#690004 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · RadarScope',directColors:true}),
  wx_radarscope_v2_hd:makeStyle(.62,.78,0,0,1,
    'linear-gradient(90deg,#d5ffff 0%,#8fcae9 12%,#4e9bd1 22%,#16d856 31%,#00a52e 42%,#08721f 50%,#ffff00 58%,#ffb000 66%,#ff5b00 73%,#ef170d 81%,#a00018 88%,#f238b7 94%,#fff5ff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'Radar Scope V2 HD · nítida',directColors:true}),
  // Refletividade operacional em classes discretas. As fontes principais
  // entregam CAPPI/PNG, então este modo preserva a grade e não fabrica raios.
  wx_radiais:makeStyle(0,0,0,0,1,
    'linear-gradient(90deg,#07152d 0%,#123c88 14%,#147ad6 22%,#21cfe3 29%,#5be36b 36%,#18a13c 44%,#087129 51%,#f2e62b 59%,#f5a623 67%,#ed5a1c 74%,#e32620 81%,#981a27 88%,#cf3da7 94%,#fff1f7 100%)',
    {wxProduct:'BR',units:'dBZ',label:'Radiais · refletividade nativa',directColors:true,variableAlpha:true}),
  wx_nws_crh:makeStyle(.58,.66,0,0,1,
    'linear-gradient(90deg,#4f4f4f 0%,#838383 12%,#ababab 18%,#03e2ff 25%,#0396ff 31%,#030eff 36%,#03ff03 42%,#03c403 47%,#02b002 51%,#026a02 56%,#fffb03 61%,#ffc901 65%,#ffaa00 70%,#ff6a02 74%,#ff0000 79%,#960000 84%,#fedeff 88%,#fe9eff 91%,#ff63ff 94%,#df0be2 97%,#ad00b0 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · NWS CRH',directColors:true}),
  wx_nssl_iii:makeStyle(.56,.58,0,0,1,
    'linear-gradient(90deg,#3d034e 0%,#373737 12%,#969696 24%,#68f361 35%,#24bf29 44%,#006e00 52%,#ffff00 60%,#ff9100 70%,#ff0000 78%,#960000 84%,#880082 89%,#04c9c9 95%,#ffffff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · NSSL III',directColors:true}),
  wx_quad_weather:makeStyle(.52,.7,0,0,1,
    'linear-gradient(90deg,#22282d 0%,#1b364a 7%,#154468 14%,#108dba 21%,#0fc8fc 28%,#1ba112 35%,#90f048 42%,#fcf702 49%,#fe9d0e 57%,#ee7e02 64%,#fa3817 71%,#d81810 78%,#b61304 84%,#feb6f3 90%,#c956fe 95%,#9a36db 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · Quad Weather',directColors:true}),
  wx_jesse_radar:makeStyle(.6,.73,0,0,1,
    'linear-gradient(90deg,#add3ff 0%,#45cc45 7%,#2eb800 14%,#4bad00 21%,#eaff05 28%,#fae100 35%,#fac400 42%,#fa9600 49%,#fa7500 56%,#fa3a00 63%,#fa1d00 70%,#960000 77%,#ff00b3 84%,#ff0080 90%,#ffc4e2 95%,#ffffff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · Jesse Radar',directColors:true}),
  wx_nws_sr:makeStyle(.54,.64,0,0,1,
    'linear-gradient(90deg,#8695b4 0%,#3150b5 13%,#69d4e0 20%,#70eee6 28%,#06690a 36%,#06690a 43%,#fff403 50%,#fff403 57%,#f58c00 64%,#ff0000 72%,#6a0000 79%,#ffa8a8 85%,#ffefef 89%,#ffffff 92%,#ff80ff 95%,#7b007d 97%,#05ff9b 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · NWS SR',directColors:true}),
  wx_awips:makeStyle(.6,.64,0,0,1,
    'linear-gradient(90deg,#969153 0%,#d2d4b4 10%,#415b9e 20%,#4361a2 29%,#6ad0e4 35%,#6fd6e8 40%,#35d55b 45%,#11d518 50%,#095e09 56%,#1d6809 61%,#ead204 66%,#ffe200 70%,#ff8000 75%,#ff0000 80%,#710000 85%,#ffffff 89%,#ff92ff 92%,#ff75ff 94%,#e10be3 96%,#b200ff 98%,#05ecf0 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · AWIPS',directColors:true}),
  wx_gr2analyst:makeStyle(.64,.7,0,0,1,
    'linear-gradient(90deg,#0b1220 0%,#24476b 13%,#2d8ac2 22%,#52dce8 29%,#2ed343 36%,#079327 44%,#f1f400 52%,#ffae00 60%,#f45116 68%,#d00000 75%,#760000 82%,#ee82d8 89%,#a128cf 95%,#f5ffff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · GR2Analyst',directColors:true}),
  wx_nexrad_hd:makeStyle(.68,.76,0,0,1,
    'linear-gradient(90deg,#071328 0%,#005cbb 14%,#02b9f2 23%,#00f0e7 29%,#00cf36 36%,#008c1d 45%,#f8ed00 53%,#ff9800 61%,#ff2c00 69%,#a90000 77%,#ff72ca 85%,#b500ed 92%,#d7ffff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · NEXRAD HD',directColors:true}),
  wx_dark_sky:makeStyle(.7,.62,0,0,.96,
    'linear-gradient(90deg,#05070b 0%,#18243f 15%,#274f89 24%,#00a8c9 31%,#00bd5a 39%,#087928 47%,#d9e900 55%,#f5a300 63%,#e94116 71%,#9c1010 79%,#cb5eb8 87%,#8b36be 94%,#e6fcff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · Dark Sky',directColors:true}),
  wx_doppler:makeStyle(.62,.78,0,0,1,
    'linear-gradient(90deg,#00009b 0%,#00ffff 14%,#006600 28%,#808080 42%,#600d17 55%,#c80000 70%,#ffff00 84%,#783c00 100%)',
    {wxProduct:'BV',units:'KTS',scale:1.9426,step:10,label:'Doppler BV · paleta visual',directColors:true}),
  wx_bv:makeStyle(.62,.78,0,0,1,
    'linear-gradient(90deg,#00009b 0%,#00ffff 14%,#006600 28%,#808080 42%,#600d17 55%,#c80000 70%,#ffff00 84%,#783c00 100%)',
    {wxProduct:'BV',units:'KTS',scale:1.9426,step:10,label:'Doppler BV · paleta visual',directColors:true}),
  doppler_cptec:makeStyle(.6,.72,0,0,1,
    'linear-gradient(90deg,#073b24 0%,#087b39 16%,#16c95a 33%,#b7dac4 46%,#c8c8c8 50%,#e4b6b8 54%,#e23b3f 68%,#a70f25 84%,#5c0718 100%)',
    {wxProduct:'BV',units:'m/s',step:5,label:'CPTEC · velocidade radial',directColors:true}),
  doppler_sr:makeStyle(.68,.82,0,0,1,
    'linear-gradient(90deg,#001e12 0%,#00652b 15%,#00b63b 29%,#6fe6a1 42%,#d3d3d3 50%,#ffb1bf 58%,#ef3139 71%,#a50025 85%,#4e0015 100%)',
    {wxProduct:'BV',units:'m/s',step:5,label:'WxTools · Storm Relative Velocity',directColors:true}),
  wx_cc:makeStyle(.5,.2,0,0,1,
    'linear-gradient(90deg,#ffffff 0%,#000000 10%,#0a0abe 22%,#7878ff 35%,#5ff564 48%,#87d70a 60%,#ffff00 70%,#ff8c00 80%,#e10300 88%,#8b1e4d 94%,#ffb4d7 97%,#a43696 100%)',
    {wxProduct:'CC',units:'RHO',scale:1,step:.1,label:'Correlation Coefficient (CC) · paleta visual',directColors:true}),
  wx_tropical_hd:makeStyle(.62,.82,0,0,1,
    'linear-gradient(90deg,#002b5b 0%,#0078d4 15%,#00d8ff 24%,#00ef9b 31%,#00c936 39%,#4d9d00 46%,#e8f000 54%,#ffbd00 61%,#ff7200 68%,#f32114 75%,#a40023 82%,#ff43c7 90%,#9137db 96%,#ffffff 100%)',
    {wxProduct:'BR',units:'dBZ',label:'WxTools · Tropical HD',directColors:true}),

  // BV/CC acima são somente paletas visuais. Produtos reais só devem ser
  // habilitados quando a fonte fornecer os campos correspondentes.
});

// Paleta visual vermelho/verde inspirada em produtos Doppler. Ela altera
// somente as cores da refletividade disponível; não cria dados de velocidade.
export function stylePaint(style='normal',opacity=.8){
  const s=RADAR_STYLES[style]||RADAR_STYLES.normal;
  if(s.directColors){
    return {
      'raster-opacity':opacity,
      'raster-contrast':0,
      'raster-saturation':0,
      'raster-hue-rotate':0,
      'raster-brightness-min':0,
      'raster-brightness-max':1,
      'raster-resampling':'nearest',
      'raster-fade-duration':0
    };
  }
  return {
    'raster-opacity':opacity,
    'raster-contrast':s.contrast,
    'raster-saturation':s.saturation,
    'raster-hue-rotate':s.hue,
    'raster-brightness-min':s.brightnessMin,
    'raster-brightness-max':s.brightnessMax,
    'raster-resampling':s.resampling,
    'raster-fade-duration':0
  };
}

export function radarPalette(name){
  const style=RADAR_STYLES[name];
  if(!style||!style.wxProduct)return null;
  const colors=[...String(style.gradient||'').matchAll(/#[0-9a-f]{6}\b/gi)].map(match=>match[0]);
  return colors.length?{name,label:style.label||name,colors,directColors:Boolean(style.directColors),product:style.wxProduct,units:style.units||null,scale:style.scale??null,step:style.step??null}:null;
}
