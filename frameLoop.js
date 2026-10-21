// Shared rAF loop. Tasks return true while they need more frames; it stops when all are idle.

const tasks = [];
let frameId = null;
let lastTime = 0;
let inFrame = false;
let wakeRequested = false;

function frame(now) {
  frameId = null;
  inFrame = true;
  wakeRequested = false;
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  let needsMore = false;
  for (const task of tasks) {
    needsMore = task(delta, now) || needsMore;
  }

  inFrame = false;
  if (needsMore || wakeRequested) {
    frameId = requestAnimationFrame(frame);
  }
}

export function wakeFrameLoop() {
  if (inFrame) {
    wakeRequested = true;
    return;
  }

  if (frameId !== null) return;
  lastTime = performance.now();
  frameId = requestAnimationFrame(frame);
}

export function addFrameTask(task) {
  tasks.push(task);
  wakeFrameLoop();
}
