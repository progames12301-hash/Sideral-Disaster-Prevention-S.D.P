import {calibrateRadarProfile,resolveRadarProfile,SUPER_RES_REFERENCE_PALETTE} from './RadarProfiles.js?v=20260929-superres2';
import {RADAR_STYLES} from '../RadarStyles.js?v=20260914-v5-clean25';

// Super-Res do Sideral
//
// O alvo visual é uma varredura de alta densidade: células pequenas,
// organizadas radialmente, com baixa intensidade em branco/cinza/azul-claro,
// azul/ciano predominantes e núcleos verdes/amarelos/laranja/vermelhos.
//
// A entrada pode ser uma imagem de radar já renderizada. Quando a fonte expõe
// metadados polares, eles são usados para reconstruir a geometria; quando não,
// a geometria é calibrada pelo footprint geográfico do raster.
//
// O algoritmo não cria ecos: cada célula só nasce de um pixel/valor válido da
// fonte. A super-resolução aumenta a densidade da malha e subdivide visualmente
// o footprint sem fabricar máximos meteorológicos.

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;
const RAD_OVER_RE = 1 / 1000 / EARTH_RADIUS_KM;

// 1024 raios (~0,3516°) é o ponto de equilíbrio que deixa os gates próximos
// da densidade das imagens de referência sem cortar o alcance operacional.
export const SUPER_RES_AZIMUTH_COUNT = 1024;

// Cerca de 1 milhão de gates é o alvo visual do Super-Res. A geometria é
// ajustada para preservar o alcance disponível em vez de truncá-lo.
const SUPER_RES_MAX_CELLS = 1_050_000;

const RADIAL_SEAM_METERS = 0.45;
const AZIMUTH_SEAM_DEGREES = 0.00008;
const RADIAL_SUPER_FACTOR = 1.35;

const REF_PALETTE = SUPER_RES_REFERENCE_PALETTE.map(rgb => Uint8Array.from(rgb));

function hexToRgb(hex) {
  const value = parseInt(hex.replace('#', ''), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function rgbDistanceSquared(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * 1.08 + dg * dg + db * db * 0.92;
}

function interpolateColor(a, b, t) {
  return Uint8Array.from([
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]);
}

function densifyPalette(colors, count = 41) {
  const source = colors?.length ? colors : REF_PALETTE;
  if (source.length >= count) return source.slice(0, count).map(c => Uint8Array.from(c));
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const pos = (i / Math.max(1, count - 1)) * (source.length - 1);
    const lo = Math.floor(pos), hi = Math.min(source.length - 1, lo + 1);
    out[i] = interpolateColor(source[lo], source[hi], pos - lo);
  }
  return out;
}

function stylePalette(name) {
  const gradient = String(RADAR_STYLES[name]?.gradient || '');
  const hexes = [...gradient.matchAll(/#[0-9a-f]{6}\b/gi)].map(match => hexToRgb(match[0]));
  return densifyPalette(hexes.length ? hexes : REF_PALETTE, 41);
}

function nearestReferenceIndex(red, green, blue) {
  let best = 0;
  let distance = Infinity;
  const source = [red, green, blue];
  for (let i = 0; i < REF_PALETTE.length; i++) {
    const candidate = rgbDistanceSquared(source, REF_PALETTE[i]);
    if (candidate < distance) {
      distance = candidate;
      best = i;
    }
  }
  return best;
}

function colorFromPalette(palette, normalized) {
  const scaled = Math.max(0, Math.min(1, normalized)) * (palette.length - 1);
  const lo = Math.floor(scaled), hi = Math.min(palette.length - 1, lo + 1);
  return interpolateColor(palette[lo], palette[hi], scaled - lo);
}

// O produto de referência contém tons quase neutros claros que NÃO podem ser
// confundidos com NoData. Já o mapa/tiles escuros devem continuar fora da malha.
function isRadarPixel(pixels, offset) {
  const alpha = pixels[offset + 3];
  if (alpha < 10) return false;

  const red = pixels[offset];
  const green = pixels[offset + 1];
  const blue = pixels[offset + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const spread = max - min;

  if (max < 8) return false;

  // Mai sensível nos ecos fracos, sem transformar transparência em eco.
  const weakBlue = (blue >= 34 && blue >= red + 5 && blue >= green - 22);
  const blueLike = (blue >= red + 10 && blue >= green - 24 && blue > 48);
  const cyanLike = (blue >= red + 8 && green >= red + 8 && blue > 58);
  const greenLike = (green >= red + 12 && green >= blue - 32 && green > 52);
  const warmLike = (red >= 138 && green >= 58 && blue <= 138);
  const paleRadar = max >= 160 && spread <= 48;
  const veryDarkBlue = blue > red + 6 && blue >= green - 2 && blue >= 22 && spread >= 5;
  const lightNeutral = max >= 42 && spread <= 28 && blue >= red - 8;

  return weakBlue || blueLike || cyanLike || greenLike || warmLike || paleRadar || veryDarkBlue || lightNeutral;
}

function normalizeReferencePalette(pixels, targetPalette = REF_PALETTE) {
  const output = new Uint8ClampedArray(pixels.length);
  let validPixels = 0;
  let recoloredPixels = 0;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if (alpha < 10 || !isRadarPixel(pixels, offset)) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      continue;
    }

    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    const referenceIndex = nearestReferenceIndex(red, green, blue);
    const normalized = REF_PALETTE.length <= 1 ? 0 : referenceIndex / (REF_PALETTE.length - 1);
    const color = colorFromPalette(targetPalette, normalized);
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = alpha;
    validPixels++;
    if (color[0] !== red || color[1] !== green || color[2] !== blue) recoloredPixels++;
  }

  return {pixels: output, validPixels, recoloredPixels};
}

export function superResDestinationPoint(radarLat, radarLon, distanceMeters, bearingDegrees) {
  const distance = distanceMeters / 1000 / EARTH_RADIUS_KM;
  const bearing = bearingDegrees * RAD;
  const lat1 = radarLat * RAD, lon1 = radarLon * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1),
    Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [((lon2 * DEG_PER_RAD + 540) % 360) - 180, lat2 * DEG_PER_RAD];
}

function mercatorY(latitude) {
  const sin = Math.sin(Math.max(-85.0511, Math.min(85.0511, latitude)) * RAD);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function haversineKm(a, b) {
  const lat1 = a[1] * RAD, lat2 = b[1] * RAD;
  const dLat = lat2 - lat1, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function containedRangeKm(sourceLayer, origin) {
  const c = sourceLayer.coordinates;
  if (!Array.isArray(c) || c.length < 4) return 250;
  const west = Number(c[0][0]), east = Number(c[1][0]);
  const north = Number(c[0][1]), south = Number(c[2][1]);
  const sides = [
    haversineKm(origin, [west, origin[1]]),
    haversineKm(origin, [east, origin[1]]),
    haversineKm(origin, [origin[0], north]),
    haversineKm(origin, [origin[0], south])
  ].filter(value => Number.isFinite(value) && value > 0);
  return sides.length ? Math.min(...sides) : 250;
}

function metersPerPixel(coordinates, width, height, radarLat) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return null;
  const west = Number(coordinates[0][0]), east = Number(coordinates[1][0]);
  const north = Number(coordinates[0][1]), south = Number(coordinates[2][1]);
  if (![west, east, north, south].every(Number.isFinite) || !(east > west) || !(north > south)) return null;
  const longitudeMeters = (east - west) * 111320 * Math.cos(radarLat * RAD);
  const latitudeMeters = (north - south) * 110574;
  const value = (longitudeMeters / Math.max(1, width) + latitudeMeters / Math.max(1, height)) / 2;
  return Number.isFinite(value) && value > 1 ? value : null;
}

async function decodeImage(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(`Super Res: imagem do radar HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), {width: bitmap.width, height: bitmap.height});
  const context = canvas.getContext('2d', {alpha: true, willReadFrequently: true});
  if (!context) throw new Error('Super Res: contexto 2D indisponível.');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Super Res shader: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    uniform mat4 u_matrix;
    uniform vec2 u_origin;
    in vec2 a_pos;
    in vec2 a_uv;
    out vec2 v_uv;
    void main(){
      v_uv = a_uv;
      gl_Position = u_matrix * vec4(u_origin + a_pos, 0.0, 1.0);
    }`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    uniform sampler2D u_texture;
    uniform float u_opacity;
    in vec2 v_uv;
    out vec4 fragColor;
    void main(){
      vec4 texel = texture(u_texture, v_uv);
      if(texel.a <= 0.004) discard;
      fragColor = vec4(texel.rgb, texel.a * u_opacity);
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Super Res program: ${log}`);
  }
  return program;
}

export function createSuperResLayer({id, sourceLayer, opacity = 1} = {}) {
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });

  const custom = {
    id,
    type: 'custom',
    renderingMode: '2d',
    ready: false,
    failed: false,
    opacity,
    readyPromise,
    palette: stylePalette(sourceLayer?.paletteName || 'super_res'),
    paletteName: sourceLayer?.paletteName || 'super_res',
    sourcePixels: null,
    sourceWidth: 0,
    sourceHeight: 0,
    stats: null,

    onAdd(map, gl) {
      this.map = map;
      this.gl = gl;
      this.abortController = new AbortController();
      try {
        this.program = createProgram(gl);
        this.aPos = gl.getAttribLocation(this.program, 'a_pos');
        this.aUv = gl.getAttribLocation(this.program, 'a_uv');
        this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
        this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
        this.uTexture = gl.getUniformLocation(this.program, 'u_texture');
        this.uOrigin = gl.getUniformLocation(this.program, 'u_origin');
      } catch (error) {
        this.failed = true;
        resolveReady(false);
        console.error(error);
        return;
      }
      void this.prepare().catch(error => {
        if (error?.name !== 'AbortError') console.error('Super Res:', error);
        this.failed = true;
        resolveReady(false);
      });
    },

    async prepare() {
      const gl = this.gl;
      const t0 = performance.now();
      const image = await decodeImage(sourceLayer.url, this.abortController.signal);
      const tDecode = performance.now();
      if (this.abortController.signal.aborted) return;

      const radarId = sourceLayer.radar?.id || sourceLayer.id || id;
      let profile = resolveRadarProfile(sourceLayer);
      const radarLat = Number(profile.latitude ?? sourceLayer.radar?.latitude ?? sourceLayer.radar?.lat);
      const radarLon = Number(profile.longitude ?? sourceLayer.radar?.longitude ?? sourceLayer.radar?.lon);
      if (!Number.isFinite(radarLat) || !Number.isFinite(radarLon) || !Array.isArray(sourceLayer.coordinates)) {
        throw new Error('Super Res: radar sem origem geográfica exata.');
      }

      const explicitRangeKm = Number(sourceLayer.radar?.rangeKm);
      const maxRangeMeters = (Number.isFinite(explicitRangeKm) && explicitRangeKm > 0
        ? explicitRangeKm
        : containedRangeKm(sourceLayer, [radarLon, radarLat])) * 1000;

      profile = calibrateRadarProfile(profile, image, maxRangeMeters, sourceLayer);
      const imageMetersPerPixel = metersPerPixel(sourceLayer.coordinates, image.width, image.height, radarLat);
      const profileGateMeters = Number(profile.gateSpacingMeters);
      const nativeAzimuthCount = Number(sourceLayer.polar?.azimuthCount ?? sourceLayer.radar?.azimuthCount);

      // A imagem é a âncora do footprint. Metadados polares podem fornecer uma
      // grade ainda mais fina, mas nunca encurtamos o alcance para caber no teto.
      let azimuthCount = Number.isFinite(nativeAzimuthCount) && nativeAzimuthCount >= 90
        ? Math.min(1440, Math.max(SUPER_RES_AZIMUTH_COUNT, Math.round(nativeAzimuthCount)))
        : SUPER_RES_AZIMUTH_COUNT;

      const rasterGateMeters = imageMetersPerPixel || Math.max(50, maxRangeMeters / 900);
      const baseGateMeters = Number.isFinite(profileGateMeters) && profileGateMeters > 0
        ? Math.min(profileGateMeters, rasterGateMeters)
        : rasterGateMeters;
      let gateDepthMeters = Math.max(35, baseGateMeters / RADIAL_SUPER_FACTOR);
      const firstGateMeters = Math.max(0, Number(profile.firstGateMeters) || 0);
      const usableRangeMeters = Math.max(1, maxRangeMeters - firstGateMeters);

      let gateCount = Math.max(1, Math.ceil(usableRangeMeters / gateDepthMeters));
      let totalCells = azimuthCount * gateCount;

      // Reduzimos raios antes de reduzir a profundidade radial, pois isso mantém
      // as placas concêntricas pequenas e evita cortar o alcance externo.
      if (totalCells > SUPER_RES_MAX_CELLS) {
        azimuthCount = Math.max(720, Math.floor(SUPER_RES_MAX_CELLS / gateCount));
        azimuthCount = Math.max(720, Math.min(1440, azimuthCount));
        totalCells = azimuthCount * gateCount;
      }
      if (totalCells > SUPER_RES_MAX_CELLS) {
        gateCount = Math.max(1, Math.floor(SUPER_RES_MAX_CELLS / azimuthCount));
        gateDepthMeters = usableRangeMeters / gateCount;
        totalCells = azimuthCount * gateCount;
      }

      const azimuthWidth = 360 / azimuthCount;
      const azimuthBase = (Number(profile.sweepStartAngleDeg) || 0) + (Number(profile.azimuthOffsetDeg) || 0);
      const contentRadiusMeters = firstGateMeters + gateCount * gateDepthMeters;

      const targetPalette = this.palette?.length ? this.palette : densifyPalette(REF_PALETTE, 41);
      const normalized = normalizeReferencePalette(image.data, targetPalette);
      this.sourcePixels = image.data;
      this.sourceWidth = image.width;
      this.sourceHeight = image.height;
      const pixelData = normalized.pixels;
      const origin = maplibregl.MercatorCoordinate.fromLngLat({lng: radarLon, lat: radarLat});

      const lat1 = radarLat * RAD, lon1 = radarLon * RAD;
      const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
      const pointMercX = (sinB, cosB, sinD, cosD) => {
        const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * cosB);
        const lon2 = lon1 + Math.atan2(sinB * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
        return ((lon2 * DEG_PER_RAD + 180) / 360) - origin.x;
      };
      const pointMercY = (cosB, sinD, cosD) => {
        const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * cosB);
        return mercatorY(lat2 * DEG_PER_RAD) - origin.y;
      };

      const capacity = Math.min(totalCells, SUPER_RES_MAX_CELLS);
      const vertexData = new Float32Array(capacity * 24);
      let cursor = 0;
      let emitted = 0;
      let skipped = 0;
      let lastYield = performance.now();

      const west = Number(sourceLayer.coordinates[0][0]), east = Number(sourceLayer.coordinates[1][0]);
      const north = Number(sourceLayer.coordinates[0][1]), south = Number(sourceLayer.coordinates[2][1]);
      const northY = mercatorY(north), southY = mercatorY(south);
      const westX = (west + 180) / 360;
      const spanX = (east - west) / 360;
      const spanY = southY - northY;
      const halfU = 0.5 / image.width, halfV = 0.5 / image.height;
      const invWidth = 1 / image.width, invHeight = 1 / image.height;

      const rays = new Float64Array(azimuthCount * 6);
      for (let rayIndex = 0; rayIndex < azimuthCount; rayIndex++) {
        const azimuth = (azimuthBase + rayIndex * azimuthWidth + 360) % 360;
        const b0 = (azimuth - azimuthWidth / 2 - AZIMUTH_SEAM_DEGREES) * RAD;
        const b1 = (azimuth + azimuthWidth / 2 + AZIMUTH_SEAM_DEGREES) * RAD;
        const bm = azimuth * RAD;
        const at = rayIndex * 6;
        rays[at] = Math.sin(b0); rays[at + 1] = Math.cos(b0);
        rays[at + 2] = Math.sin(b1); rays[at + 3] = Math.cos(b1);
        rays[at + 4] = Math.sin(bm); rays[at + 5] = Math.cos(bm);
      }

      for (let gateIndex = 0; gateIndex < gateCount; gateIndex++) {
        const rangeStart = firstGateMeters + gateIndex * gateDepthMeters;
        const rangeCenter = rangeStart + gateDepthMeters / 2;
        const rangeEnd = rangeStart + gateDepthMeters;
        const dCenter = rangeCenter * RAD_OVER_RE;
        const dStart = Math.max(0, rangeStart - RADIAL_SEAM_METERS / 2) * RAD_OVER_RE;
        const dEnd = (rangeEnd + RADIAL_SEAM_METERS / 2) * RAD_OVER_RE;
        const cosDC = Math.cos(dCenter), sinDC = Math.sin(dCenter);
        const cosDS = Math.cos(dStart), sinDS = Math.sin(dStart);
        const cosDE = Math.cos(dEnd), sinDE = Math.sin(dEnd);
        const latBase = sinLat1 * cosDC, latAmp = cosLat1 * sinDC;

        for (let rayIndex = 0; rayIndex < azimuthCount; rayIndex++) {
          const at = rayIndex * 6;
          const sinB0 = rays[at], cosB0 = rays[at + 1];
          const sinB1 = rays[at + 2], cosB1 = rays[at + 3];
          const sinBm = rays[at + 4], cosBm = rays[at + 5];

          const latC = Math.asin(latBase + latAmp * cosBm);
          const lonC = lon1 + Math.atan2(
            sinBm * sinDC * cosLat1,
            cosDC - sinLat1 * Math.sin(latC)
          );
          const sampleX = (((lonC * DEG_PER_RAD + 180) / 360) - westX) / spanX * (image.width - 1);
          const sampleY = (mercatorY(latC * DEG_PER_RAD) - northY) / spanY * (image.height - 1);
          const sx = Math.round(sampleX), sy = Math.round(sampleY);
          if (sx < 0 || sx >= image.width || sy < 0 || sy >= image.height) {
            skipped++;
            continue;
          }
          const offset = (sy * image.width + sx) * 4;
          if (pixelData[offset + 3] < 10) {
            skipped++;
            continue;
          }

          const x0 = pointMercX(sinB0, cosB0, sinDS, cosDS), y0 = pointMercY(cosB0, sinDS, cosDS);
          const x1 = pointMercX(sinB0, cosB0, sinDE, cosDE), y1 = pointMercY(cosB0, sinDE, cosDE);
          const x2 = pointMercX(sinB1, cosB1, sinDE, cosDE), y2 = pointMercY(cosB1, sinDE, cosDE);
          const x3 = pointMercX(sinB1, cosB1, sinDS, cosDS), y3 = pointMercY(cosB1, sinDS, cosDS);
          const u = (sampleX + 0.5) * invWidth, v = (sampleY + 0.5) * invHeight;
          const u0 = Math.max(0, u - halfU), u1 = Math.min(1, u + halfU);
          const v0 = Math.max(0, v - halfV), v1 = Math.min(1, v + halfV);

          vertexData[cursor++] = x0; vertexData[cursor++] = y0; vertexData[cursor++] = u0; vertexData[cursor++] = v0;
          vertexData[cursor++] = x1; vertexData[cursor++] = y1; vertexData[cursor++] = u0; vertexData[cursor++] = v1;
          vertexData[cursor++] = x2; vertexData[cursor++] = y2; vertexData[cursor++] = u1; vertexData[cursor++] = v1;
          vertexData[cursor++] = x0; vertexData[cursor++] = y0; vertexData[cursor++] = u0; vertexData[cursor++] = v0;
          vertexData[cursor++] = x2; vertexData[cursor++] = y2; vertexData[cursor++] = u1; vertexData[cursor++] = v1;
          vertexData[cursor++] = x3; vertexData[cursor++] = y3; vertexData[cursor++] = u1; vertexData[cursor++] = v0;
          emitted++;
        }

        if ((gateIndex & 7) === 7 || performance.now() - lastYield > 60) {
          lastYield = performance.now();
          if (this.abortController.signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      const tMeshDone = performance.now();
      if (this.abortController.signal.aborted) return;
      if (!emitted) throw new Error('Super Res: nenhum gate válido foi encontrado na imagem.');

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        image.width, image.height, 0, gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixelData
      );
      this.texture = texture;
      this.paletteName = sourceLayer.paletteName || this.paletteName;

      const vertices = vertexData.subarray(0, cursor);
      this.vertexCount = vertices.length / 4;
      this.originX = origin.x;
      this.originY = origin.y;
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      this.stats = {
        radar: radarId,
        mode: 'image → polar super-res',
        palette: this.paletteName,
        azimuths: azimuthCount,
        gates: gateCount,
        cells: emitted,
        skipped,
        gateMeters: gateDepthMeters.toFixed(1) + ' m',
        baseGateMeters: baseGateMeters.toFixed(1) + ' m',
        imageMetersPerPixel: imageMetersPerPixel ? imageMetersPerPixel.toFixed(1) + ' m' : 'desconhecido',
        coverage: (contentRadiusMeters / 1000).toFixed(0) + ' km',
        image: image.width + 'x' + image.height,
        validSourcePixels: normalized.validPixels,
        recoloredSourcePixels: normalized.recoloredPixels,
        msDecode: Math.round(tDecode - t0),
        msMesh: Math.round(tMeshDone - tDecode),
        msTotal: Math.round(tMeshDone - t0)
      };

      if (globalThis.SIDERAL_SUPER_RES_DEBUG) console.info('Sideral Super Res', this.stats);

      this.ready = true;
      resolveReady(true);
      this.map.triggerRepaint();
    },

    setOpacity(value) {
      this.opacity = value;
      this.map?.triggerRepaint();
    },

    setPalette(palette, name = 'custom') {
      const nextPalette = Array.isArray(palette) && palette.length
        ? densifyPalette(palette.map(color => Uint8Array.from(color)), 41)
        : stylePalette(name);
      this.palette = nextPalette;
      this.paletteName = name;
      if (!this.texture || !this.sourcePixels || !this.gl) {
        this.map?.triggerRepaint();
        return;
      }
      const recolored = normalizeReferencePalette(this.sourcePixels, this.palette);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.sourceWidth, this.sourceHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, recolored.pixels);
      if (this.stats) {
        this.stats.palette = name;
        this.stats.validSourcePixels = recolored.validPixels;
        this.stats.recoloredSourcePixels = recolored.recoloredPixels;
      }
      this.map?.triggerRepaint();
    },

    render(gl, args) {
      if (!this.ready || !this.program || !this.vertexBuffer) return;
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uMatrix, false, args.defaultProjectionData.mainMatrix);
      gl.uniform1f(this.uOpacity, this.opacity);
      gl.uniform2f(this.uOrigin, this.originX, this.originY);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.uTexture, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    },

    onRemove(map, gl) {
      this.abortController?.abort();
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.program) gl.deleteProgram(this.program);
      this.vertexBuffer = null;
      this.texture = null;
      this.ready = false;
    }
  };

  return custom;
}
