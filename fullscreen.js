import { attachMapGestures } from "./map-gestures.js?v=10";

let active = null;

export function closeFullscreen() {
  active?.close();
}

export function openFullscreen({ content, stage, canvas, title = "Карта неба", navigation, settings, captureInteraction, canStartGesture, onSingleTouchEnd }) {
  closeFullscreen();
  const previousFocus = document.activeElement;
  const parent = content.closest("dialog[open]") || document.body;
  const shell = document.createElement("div");
  shell.className = "fullscreen-shell";
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-label", title);
  shell.innerHTML = `<div class="fullscreen-toolbar"><strong class="fullscreen-title"></strong><span data-fullscreen-result aria-live="polite"></span><div class="fullscreen-zoom"><button type="button" aria-label="Уменьшить карту">−</button><output aria-label="Масштаб карты">100%</output><button type="button" aria-label="Увеличить карту">+</button><button type="button" data-reset>Вписать</button></div><button type="button" data-settings aria-expanded="false">⚙ Параметры</button><button type="button" data-close aria-label="Закрыть полноэкранную карту">✕ Закрыть</button></div><div class="fullscreen-navigation"></div><div class="fullscreen-content"></div>`;
  shell.querySelector(".fullscreen-title").textContent = title;
  const moved = [];
  function move(element, destination) {
    const anchor = document.createComment("fullscreen position");
    element.before(anchor);
    destination.append(element);
    moved.push({ element, anchor });
  }
  parent.append(shell);
  move(content, shell.querySelector(".fullscreen-content"));
  const nav = shell.querySelector(".fullscreen-navigation");
  if (navigation) move(navigation, nav);
  else nav.hidden = true;

  const viewport = document.createElement("div");
  viewport.className = "fullscreen-map-viewport";
  viewport.setAttribute("aria-label", "Область карты; двумя пальцами можно перемещать карту и менять масштаб");
  stage.before(viewport);
  move(stage, viewport);
  const originalWidth = stage.style.width;
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  let zoom = 1, native = false, closed = false;
  let panning = false, drag = null;
  const removeGestures = attachMapGestures({
    viewport, stage, getZoom: () => zoom, setZoom: changeZoom,
    captureInteraction, canStartGesture,
    onSingleTouchEnd: () => { if (!panning) onSingleTouchEnd?.(); },
    onStart: () => { drag = null; },
  });
  const panButton = document.createElement("button");
  panButton.type = "button";
  panButton.textContent = "Перемещать";
  panButton.setAttribute("aria-pressed", "false");
  panButton.setAttribute("aria-label", "Перемещать увеличенную карту");
  shell.querySelector(".fullscreen-zoom").append(panButton);
  panButton.onclick = () => {
    panning = !panning;
    panButton.setAttribute("aria-pressed", String(panning));
    viewport.classList.toggle("is-panning", panning);
  };
  viewport.addEventListener("pointerdown", event => {
    if (!panning || event.button !== 0) return;
    if (event.pointerType === "touch" && canStartGesture?.() === false) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture?.(event.pointerId);
  }, true);
  viewport.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  }, true);
  const stopDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.stopImmediatePropagation();
    if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    drag = null;
  };
  viewport.addEventListener("pointerup", stopDrag, true);
  viewport.addEventListener("pointercancel", stopDrag, true);
  const zoomButtons = shell.querySelectorAll(".fullscreen-zoom button");
  const output = shell.querySelector("output");
  function fit() {
    if (closed) return;
    const ratio = canvas.width / canvas.height;
    const width = Math.max(80, Math.min(viewport.clientWidth - 24, (viewport.clientHeight - 24) * ratio));
    stage.style.width = `${width * zoom}px`;
    output.value = `${Math.round(zoom * 100)}%`;
    output.textContent = output.value;
    zoomButtons[0].disabled = zoom <= 1;
    zoomButtons[1].disabled = zoom >= 3;
  }
  function changeZoom(value) {
    zoom = Math.max(1, Math.min(3, value));
    fit();
  }
  zoomButtons[0].onclick = () => changeZoom(zoom - 0.25);
  zoomButtons[1].onclick = () => changeZoom(zoom + 0.25);
  shell.querySelector("[data-reset]").onclick = () => { changeZoom(1); viewport.scrollTop = viewport.scrollLeft = 0; };
  const settingsButton = shell.querySelector("[data-settings]");
  const settingsHidden = settings?.hidden;
  let drawer;
  if (settings) {
    drawer = document.createElement("div");
    drawer.className = "fullscreen-settings";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "Параметры карты");
    shell.querySelector(".fullscreen-content").append(drawer);
    move(settings, drawer);
    settings.hidden = false;
    settingsButton.onclick = () => {
      drawer.hidden = !drawer.hidden;
      settingsButton.setAttribute("aria-expanded", String(!drawer.hidden));
    };
  } else settingsButton.hidden = true;
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
  resize?.observe(viewport);
  const Mutation = globalThis.MutationObserver || document.defaultView?.MutationObserver;
  const changes = Mutation ? new Mutation(fit) : null;
  changes?.observe(canvas, { attributes: true, attributeFilter: ["width", "height", "hidden"] });
  const windowObject = document.defaultView || globalThis;
  windowObject.addEventListener("resize", fit);
  function keydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const focusable = [...shell.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function fullscreenChanged() {
    if (document.fullscreenElement === shell) { native = true; fit(); }
    else if (native) close();
  }
  function close() {
    if (closed) return;
    closed = true;
    active = null;
    resize?.disconnect();
    changes?.disconnect();
    removeGestures();
    windowObject.removeEventListener("resize", fit);
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    if (document.fullscreenElement === shell) document.exitFullscreen?.().catch(() => {});
    stage.style.width = originalWidth;
    for (const { element, anchor } of moved.reverse()) anchor.replaceWith(element);
    viewport.remove();
    if (settings) settings.hidden = settingsHidden;
    shell.remove();
    document.body.style.overflow = originalOverflow;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  shell.querySelector("[data-close]").onclick = close;
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  active = { close };
  fit();
  shell.querySelector("[data-close]").focus({ preventScroll: true });
  try { shell.requestFullscreen?.().catch(() => {}); } catch { /* The viewport overlay works without native fullscreen. */ }
  return active;
}
