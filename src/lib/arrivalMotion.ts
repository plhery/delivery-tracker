/** Decorative motion only: no persistence, permission prompts, or React render loop. */
export function bindArrivalMotion(root: HTMLElement) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let lastTime = 0;
  let x = 0, y = 0, targetX = 0, targetY = 0;
  let baseline: { beta: number; gamma: number } | null = null;
  let listening = false;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const write = () => {
    root.style.setProperty('--parcel-x', x.toFixed(4));
    root.style.setProperty('--parcel-y', y.toFixed(4));
  };
  const step = (time: number) => {
    const dt = lastTime ? Math.min(time - lastTime, 50) : 16;
    lastTime = time;
    const blend = 1 - Math.exp(-dt / 110);
    x += (targetX - x) * blend;
    y += (targetY - y) * blend;
    if (Math.abs(x - targetX) + Math.abs(y - targetY) < .001) {
      x = targetX; y = targetY; frame = 0; lastTime = 0;
    } else frame = requestAnimationFrame(step);
    write();
  };
  const move = (nextX: number, nextY: number) => {
    targetX = clamp(nextX); targetY = clamp(nextY);
    if (!frame) frame = requestAnimationFrame(step);
  };
  const pointer = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
    const bounds = root.getBoundingClientRect();
    move((event.clientX - bounds.left - bounds.width / 2) / Math.max(180, bounds.width / 2),
      (event.clientY - bounds.top - bounds.height * .45) / Math.max(220, bounds.height / 2));
  };
  const leave = () => move(0, 0);
  const release = (event: PointerEvent) => { if (event.pointerType !== 'mouse') leave(); };
  const orient = (event: DeviceOrientationEvent) => {
    if (event.beta == null || event.gamma == null || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    if (!baseline) { baseline = { beta: event.beta, gamma: event.gamma }; return; }
    const angle = (window.screen.orientation?.angle ?? 0) * Math.PI / 180;
    const beta = ((event.beta - baseline.beta + 540) % 360 - 180) / 25;
    const gamma = ((event.gamma - baseline.gamma + 540) % 360 - 180) / 25;
    move(gamma * Math.cos(angle) + beta * Math.sin(angle), beta * Math.cos(angle) - gamma * Math.sin(angle));
  };
  const recalibrate = () => { baseline = null; leave(); };
  const stop = () => {
    root.removeEventListener('pointermove', pointer);
    root.removeEventListener('pointerleave', leave);
    root.removeEventListener('pointerup', release);
    root.removeEventListener('pointercancel', leave);
    window.removeEventListener('deviceorientation', orient);
    window.removeEventListener('orientationchange', recalibrate);
    cancelAnimationFrame(frame);
    frame = 0; lastTime = 0; baseline = null;
    x = y = targetX = targetY = 0; write(); listening = false;
  };
  const sync = () => {
    const paused = reduced.matches || document.hidden;
    root.dataset.motionPaused = String(paused);
    if (paused) { stop(); return; }
    if (listening) return;
    listening = true;
    root.addEventListener('pointermove', pointer, { passive: true });
    root.addEventListener('pointerleave', leave, { passive: true });
    root.addEventListener('pointerup', release, { passive: true });
    root.addEventListener('pointercancel', leave, { passive: true });
    // Permission-gated browsers keep touch/pointer motion until access already
    // exists. A decorative effect never interrupts opening with a permission UI.
    window.addEventListener('deviceorientation', orient, { passive: true });
    window.addEventListener('orientationchange', recalibrate);
  };
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    stop();
    reduced.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
    delete root.dataset.motionPaused;
  };
}
