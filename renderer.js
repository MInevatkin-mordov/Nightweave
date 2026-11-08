import { RAD, camera, clamp, projector } from "./astro.js?v=10";

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
export const mapHeight = (width, config) =>
  config.shape === "rectangle"
    ? Math.round(width / (config.aspect || 1.6))
    : width;

export async function rasterize(
  config,
  size,
  texture,
  yieldRows = true,
  cancelled = () => false,
) {
  const basis = camera(config),
    half = size / 2,
    edge = half - 2;
  const height = mapHeight(size, config);
  const limit = (config.fov * RAD) / 2;
  const scale =
    config.projection === "stereo"
      ? 2 * Math.tan(limit / 2)
      : config.projection === "gnomonic"
        ? Math.tan(limit)
        : config.projection === "orthographic"
          ? Math.sin(limit)
          : limit;
  const paper = config.display === "paper";
  const background = paper
    ? [255, 255, 255]
    : config.display === "mono"
      ? [3, 8, 14]
      : [5, 13, 21];
  const image = new Uint8ClampedArray(size * height * 4);
  const textured = config.display === "milkyway" && texture;
  for (let row = 0; row < height; row++) {
    if (row % 32 === 0) {
      if (cancelled()) return null;
      if (yieldRows) await pause();
    }
    const y = (row - height / 2) / edge;
    for (let col = 0; col < size; col++) {
      const index = (row * size + col) * 4,
        x = (col - half) / edge;
      image[index] = background[0];
      image[index + 1] = background[1];
      image[index + 2] = background[2];
      image[index + 3] = 255;
      const radius = Math.hypot(x, y);
      if (
        (config.shape !== "rectangle" && radius > 1) ||
        (!textured && !config.horizon)
      )
        continue;
      const distance = radius * scale;
      if (config.projection === "orthographic" && distance > 1) continue;
      const angle =
        config.projection === "stereo"
          ? 2 * Math.atan(distance / 2)
          : config.projection === "gnomonic"
            ? Math.atan(distance)
            : config.projection === "orthographic"
              ? Math.asin(Math.min(1, distance))
              : distance;
      const factor = radius ? Math.sin(angle) / radius : 0,
        cosine = Math.cos(angle);
      const vx =
        basis.forward[0] * cosine +
        factor * (x * basis.right[0] - y * basis.up[0]);
      const vy =
        basis.forward[1] * cosine +
        factor * (x * basis.right[1] - y * basis.up[1]);
      const vz =
        basis.forward[2] * cosine +
        factor * (x * basis.right[2] - y * basis.up[2]);
      if (
        config.horizon &&
        vx * basis.zenith[0] + vy * basis.zenith[1] + vz * basis.zenith[2] < 0
      ) {
        if (!paper) {
          image[index] = 15;
          image[index + 1] = 23;
          image[index + 2] = 27;
        }
        continue;
      }
      if (!textured) continue;
      const u =
        ((0.5 - Math.atan2(vy, vx) / (2 * Math.PI) + 1) % 1) * texture.width;
      const v = clamp(
        (0.5 - Math.asin(clamp(vz, -1, 1)) / Math.PI) * texture.height,
        0,
        texture.height - 1,
      );
      const x0 = Math.floor(u),
        y0 = Math.floor(v),
        fx = u - x0,
        fy = v - y0;
      const x1 = (x0 + 1) % texture.width,
        y1 = Math.min(y0 + 1, texture.height - 1);
      for (let c = 0; c < 3; c++) {
        const top =
          texture.pixels[(y0 * texture.width + x0) * 4 + c] * (1 - fx) +
          texture.pixels[(y0 * texture.width + x1) * 4 + c] * fx;
        const bottom =
          texture.pixels[(y1 * texture.width + x0) * 4 + c] * (1 - fx) +
          texture.pixels[(y1 * texture.width + x1) * 4 + c] * fx;
        image[index + c] = Math.min(
          255,
          background[c] + (top * (1 - fy) + bottom * fy) * config.exposure,
        );
      }
    }
  }
  return image;
}

export function paintStars(canvas, catalog, config) {
  const ctx = canvas.getContext("2d"),
    p = projector(config),
    size = canvas.width,
    center = size / 2,
    radius = center - 2;
  const paper = config.display === "paper",
    mono = paper || config.display === "mono";
  for (const [ra, dec, magnitude, bv] of catalog.stars) {
    if (magnitude > config.magnitude) continue;
    const point = p.project(ra, dec);
    if (!point) continue;
    const x = center + point[0] * radius,
      y = canvas.height / 2 + point[1] * radius;
    const r =
      (Math.max(0.5, (3.1 - magnitude * 0.43) * (config.starSize || 1)) *
        size) /
      1000;
    ctx.fillStyle = paper
      ? "#111"
      : mono
        ? "#fff"
        : bv > 1
          ? "#ffe0b3"
          : bv < 0
            ? "#c6e3ff"
            : "#e9f2f6";
    ctx.globalAlpha = mono ? 1 : clamp(1.4 - magnitude * 0.12, 0.45, 1);
    if (!mono && config.display === "milkyway" && magnitude < 2) {
      const color = ctx.fillStyle,
        halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      halo.addColorStop(0, "#c5e4ff70");
      halo.addColorStop(1, "#b8dfff00");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = paper ? "#111" : "#3b4f5e";
  ctx.lineWidth = Math.max(1, size / 1000);
  ctx.beginPath();
  if (config.shape === "rectangle")
    ctx.rect(2, 2, canvas.width - 4, canvas.height - 4);
  else ctx.arc(center, center, radius, 0, 2 * Math.PI);
  ctx.stroke();
}

export function vectorMap(canvas, catalog, config) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle =
    config.display === "paper"
      ? "#fff"
      : config.display === "mono"
        ? "#03080e"
        : "#050d15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  paintStars(canvas, catalog, config);
}

export class SkyRenderer {
  constructor() {
    this.revision = 0;
    this.cache = new Map();
    this.pending = new Map();
    if (typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(new URL("./sky-worker.js?v=10", import.meta.url), {
          type: "module",
        });
        this.worker.onmessage = ({ data }) => {
          this.pending.get(data.id)?.(data);
          this.pending.delete(data.id);
        };
        this.worker.onerror = () => {
          for (const resolve of this.pending.values()) resolve(null);
          this.pending.clear();
          this.worker.terminate();
          this.worker = null;
        };
      } catch {
        this.worker = null;
      }
    }
  }
  setTexture(texture) {
    this.texture = texture;
    this.worker?.postMessage({ texture });
    this.cache.clear();
  }
  async render(canvas, catalog, config, onStage = () => {}) {
    const revision = ++this.revision;
    const {
      ra,
      dec,
      az,
      alt,
      frame,
      latitude,
      longitude,
      date,
      roll,
      fov,
      projection,
      horizon,
      display,
      magnitude,
      starSize,
      exposure,
    } = config;
    const key = JSON.stringify([
      canvas.width,
      canvas.height,
      config.shape,
      config.aspect,
      ra,
      dec,
      az,
      alt,
      frame,
      latitude,
      longitude,
      date,
      roll,
      fov,
      projection,
      horizon,
      display,
      magnitude,
      starSize,
      exposure,
      Boolean(this.texture),
    ]);
    const ctx = canvas.getContext("2d");
    if (this.cache.has(key)) {
      ctx.putImageData(this.cache.get(key), 0, 0);
      onStage("Готово · из кэша");
      return true;
    }
    vectorMap(canvas, catalog, config);
    const textured = display === "milkyway" && this.texture;
    if (!textured && !horizon) {
      onStage("Готово");
      return true;
    }
    onStage("Предпросмотр · уточняем фон…");
    await pause();
    const isCancelled = () => revision !== this.revision;
    let pixels;
    if (this.worker) {
      const data = await new Promise((resolve) => {
        this.pending.set(revision, resolve);
        this.worker.postMessage({ id: revision, config, size: canvas.width });
      });
      if (data?.pixels) pixels = new Uint8ClampedArray(data.pixels);
    }
    if (!pixels && !isCancelled())
      pixels = await rasterize(
        config,
        canvas.width,
        this.texture,
        true,
        isCancelled,
      );
    if (!pixels || isCancelled()) return false;
    const image = ctx.createImageData(canvas.width, canvas.height);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    paintStars(canvas, catalog, config);
    this.cache.set(key, ctx.getImageData(0, 0, canvas.width, canvas.height));
    while (this.cache.size > 3)
      this.cache.delete(this.cache.keys().next().value);
    onStage("Готово");
    return true;
  }
}
