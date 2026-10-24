// BrasilScope V5 radar geometry profiles. Native provider metadata always wins;
// these profiles supply physical geometry when a provider only publishes PNG+PGW.
const CPTEC_SITES=Object.freeze({
  'cptec-bauru-e-pres-prudente':[-50.00,-22.30],
  'cptec-belem':[-48.44,-1.41],'cptec-boa-vista':[-60.67,2.82],
  'cptec-cangucu-rs':[-52.68,-31.40],'cptec-cruzeiro-do-sul':[-72.67,-7.63],
  'cptec-gama':[-48.04,-15.99],'cptec-jaraguari':[-54.40,-20.14],
  'cptec-macapa':[-51.07,.04],'cptec-maceio':[-35.77,-9.55],
  'cptec-manaus':[-59.99,-3.15],'cptec-morro-da-igreja':[-49.48,-28.13],
  'cptec-natal':[-35.20,-5.84],'cptec-petrolina':[-40.54,-9.37],
  'cptec-pico-do-couto':[-43.29,-22.46],'cptec-porto-velho':[-63.90,-8.71],
  'cptec-salvador':[-38.51,-12.99],'cptec-santarem':[-54.71,-2.44],
  'cptec-santiago':[-54.88,-29.19],'cptec-sao-francisco':[-44.86,-15.95],
  'cptec-sao-gabriel':[-67.09,-.13],'cptec-sao-luiz':[-44.21,-2.59],
  'cptec-sao-roque':[-47.09,-23.60],'cptec-tabatinga':[-69.94,-4.25],
  'cptec-tefe':[-64.72,-3.38],'cptec-tres-marias':[-45.24,-18.20]
});

export const SUPER_RES_DBZ_PALETTE=Object.freeze([
  [96,168,224],[104,216,240],[16,216,40],[8,200,24],[8,184,8],[8,152,8],[8,120,8],
  [120,168,8],[248,232,8],[248,200,8],[255,136,0],[248,48,8],[224,0,0],[255,255,255]
]);

const BASE_PROFILE=Object.freeze({
  azimuthCount:720,radialGateCount:128,gateSpacingMeters:null,firstGateMeters:null,centerHoleFraction:.055,maxGates:2200,
  azimuthOffsetDeg:0,sweepStartAngleDeg:0,beamWidthDeg:null,expectedRangeKm:null,
  noDataPolicy:'transparent',clipPolicy:'published-coverage',paletteName:'wx_scope5',
  allowJaggedRangeEdge:true,keepMissingRadials:true,keepMissingGates:true,calibration:'raster-footprint'
});

export const RADAR_PROFILES=Object.freeze(Object.fromEntries(Object.entries(CPTEC_SITES).map(([id,[longitude,latitude]])=>{
  const baseline=id==='cptec-jaraguari'?{calibration:'baseline-ms'}:{};
  return [id,Object.freeze({...BASE_PROFILE,id,longitude,latitude,...baseline})];
})));

export function resolveRadarProfile(sourceLayer={}){
  const id=String(sourceLayer.radar?.id||sourceLayer.id||'').toLowerCase();
  const configured=RADAR_PROFILES[id]||{};
  return {...BASE_PROFILE,...configured,id:id||'generic-v5'};
}

export function calibrateRadarProfile(profile,image,maxRangeMeters,sourceLayer={}){
  const polar=sourceLayer.polar||sourceLayer.radar?.polar||{};
  const nativeAzimuths=Array.isArray(polar.azimuths)?polar.azimuths.length:0;
  const nativeAzimuthCount=Number(polar.azimuthCount||sourceLayer.radar?.azimuthCount)||nativeAzimuths;
  const nativeGateSpacing=Number(polar.rangeResolutionMeters??polar.gateSizeMeters??sourceLayer.radar?.rangeResolutionMeters);
  const nativeFirstGate=Number(polar.firstGateMeters??polar.minRangeMeters??sourceLayer.radar?.firstGateMeters);
  const nativeBeam=Number(polar.beamWidthDegrees??sourceLayer.radar?.beamWidthDegrees);
  if(nativeAzimuthCount>0||nativeGateSpacing>0)return {...profile,
    azimuthCount:nativeAzimuthCount||profile.azimuthCount||720,
    gateSpacingMeters:nativeGateSpacing>0?nativeGateSpacing:profile.gateSpacingMeters,
    firstGateMeters:nativeFirstGate>=0?nativeFirstGate:(profile.firstGateMeters??0),
    beamWidthDeg:nativeBeam>0?nativeBeam:profile.beamWidthDeg,
    calibration:'native-metadata'};
  const azimuthCount=Math.max(360,Math.min(1440,Math.round(Number(profile.azimuthCount)||720)));
  const radialGateCount=Math.max(32,Math.min(512,Math.round(Number(profile.radialGateCount)||128)));
  const firstGateMeters=profile.firstGateMeters!==null&&profile.firstGateMeters!==undefined&&Number.isFinite(Number(profile.firstGateMeters))
    ?Math.max(0,Number(profile.firstGateMeters))
    :Math.max(0,maxRangeMeters*(Number(profile.centerHoleFraction)||0));
  const usableRangeMeters=Math.max(1,maxRangeMeters-firstGateMeters);
  const gateSpacingMeters=usableRangeMeters/radialGateCount;
  return {...profile,azimuthCount,radialGateCount,beamWidthDeg:profile.beamWidthDeg||360/azimuthCount,
    firstGateMeters,gateSpacingMeters,maxGates:Math.min(profile.maxGates,radialGateCount),
    calibration:profile.calibration==='baseline-ms'?'baseline-ms-reference':'reference-polar-profile'};
}

export function cptecReflectivityCode(data,offset){
  const red=data[offset],green=data[offset+1],blue=data[offset+2],alpha=data[offset+3];
  if(alpha<12)return 255;
  const max=Math.max(red,green,blue),min=Math.min(red,green,blue);
  if(max<8)return 255;
  if(blue>green*1.08&&blue>red*1.15)return green<55?0:1;
  if(blue>100&&green>100&&red<100)return green>190?2:1;
  if(green>red*1.18&&green>blue*1.08){if(green>=220)return 2;if(green>=180)return 3;if(green>=140)return 4;if(green>=100)return 5;return 6}
  if(green>=red*.9&&blue<100){if(red<120)return 6;if(red<220)return 7;return green>=235?8:9}
  if(red>green*1.2&&red>blue*1.2){if(blue>120)return 13;if(green>=150)return 9;if(green>=80)return 10;if(red>=220)return 11;return 12}
  if(red>185&&blue>130&&green<170)return 13;
  if(max-min<18)return max>225?12:255;
  return 6;
}
