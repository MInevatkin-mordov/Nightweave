export function attachMapGestures({ viewport, stage, getZoom, setZoom, captureInteraction, onStart, canStartGesture, onSingleTouchEnd }) {
  const touches = new Map();
  let consumed = false, baseline = null, rollback = null;

  function metrics() {
    const [a, b] = [...touches.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    };
  }

  function rebase() {
    const center = metrics();
    const rect = stage.getBoundingClientRect();
    baseline = {
      ...center,
      zoom: getZoom(),
      anchorX: rect.width ? (center.x - rect.left) / rect.width : 0.5,
      anchorY: rect.height ? (center.y - rect.top) / rect.height : 0.5,
    };
  }

  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function down(event) {
    if (event.pointerType !== "touch") return;
    if (canStartGesture?.() === false) return;
    const previousCount = touches.size;
    if (touches.size === 0) rollback = captureInteraction?.();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size < 2 && !consumed) return;
    block(event);
    if (!consumed) {
      consumed = true;
      onStart?.();
      rollback?.();
      rollback = null;
      viewport.classList.add("is-gesturing");
      for (const id of touches.keys()) {
        try { viewport.setPointerCapture?.(id); } catch { /* A pointer may already have ended. */ }
      }
      rebase();
    } else {
      try { viewport.setPointerCapture?.(event.pointerId); } catch { /* A pointer may already have ended. */ }
      if (previousCount < 2 && touches.size >= 2) rebase();
    }
  }

  function move(event) {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!consumed) return;
    block(event);
    if (touches.size < 2) return;
    const center = metrics();
    setZoom(baseline.zoom * center.distance / baseline.distance);
    const rect = stage.getBoundingClientRect();
    viewport.scrollLeft += rect.left + baseline.anchorX * rect.width - center.x;
    viewport.scrollTop += rect.top + baseline.anchorY * rect.height - center.y;
  }

  function up(event) {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);
    if (!consumed && !touches.size && event.type === "pointerup") onSingleTouchEnd?.();
    if (consumed) {
      block(event);
      if (touches.size >= 2) rebase();
      try {
        if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      } catch { /* Canceled pointers may have lost capture already. */ }
    }
    if (!touches.size) {
      consumed = false;
      baseline = rollback = null;
      viewport.classList.remove("is-gesturing");
    }
  }

  const listeners = [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]];
  for (const [type, listener] of listeners) viewport.addEventListener(type, listener, { capture: true, passive: false });
  return () => {
    for (const [type, listener] of listeners) viewport.removeEventListener(type, listener, { capture: true });
    touches.clear();
    rollback = baseline = null;
  };
}
