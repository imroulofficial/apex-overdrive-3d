// Finger-drag free look. A finger that goes down on empty screen (the 3D canvas itself, not a
// HUD control) and drags turns the race camera only: the follow views orbit the car, the
// driver view turns the driver's head (race/chaseCamera.js freeLookDrag). When it lifts, the
// camera eases back on its own (FREE_LOOK.returnTime).
//
// It never reaches the car's input: it listens on the canvas alone, and a touch that starts on
// a control is delivered to that control by the browser, never to the canvas, so it can never
// start a free look. The free-look finger is captured by the canvas, so sliding it over a
// control later neither presses nor releases that control. Other fingers holding the steering,
// GAS or NITRO carry on untouched (each pointer has its own target).

export const SLOP_PX = 4; // movement before a touch counts as a drag (a tap does nothing)

// surface: the canvas element; isActive(): whether free look is allowed right now (racing,
// countdown); onDrag(dx, dy) in pixels; onRelease() when the finger lifts or is cancelled.
export function createFreeLook({ surface, isActive, onDrag, onRelease }) {
  let id = null;
  let x = 0;
  let y = 0;
  let dragging = false;

  const end = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    if (dragging) onRelease();
    dragging = false;
  };

  surface.addEventListener('pointerdown', (e) => {
    if (id !== null || !isActive()) return;
    if (e.target && e.target !== surface) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    id = e.pointerId;
    x = e.clientX;
    y = e.clientY;
    dragging = false;
    try {
      surface.setPointerCapture?.(id);
    } catch {
      // A pointer that is already gone: the up/cancel that follows ends it.
    }
  });

  surface.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!isActive()) {
      end(e);
      return;
    }
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    if (!dragging && Math.hypot(dx, dy) < SLOP_PX) return;
    dragging = true;
    x = e.clientX;
    y = e.clientY;
    onDrag(dx, dy);
  });

  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(t, end);

  return {
    get active() {
      return dragging;
    },
    // Drops the finger (pause, race end): the camera eases back.
    release() {
      if (id === null) return;
      const p = id;
      end({ pointerId: p });
    },
  };
}
