import { rasterize } from "./renderer.js?v=10";

let texture;
self.onmessage = async ({ data }) => {
  if (data.texture) {
    texture = data.texture;
    return;
  }
  try {
    const pixels = await rasterize(data.config, data.size, texture, false);
    self.postMessage({ id: data.id, pixels: pixels.buffer }, [pixels.buffer]);
  } catch {
    self.postMessage({ id: data.id, error: true });
  }
};
