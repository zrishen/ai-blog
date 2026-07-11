export interface PatchDeltaPlayer {
  push(delta: string): void;
  open(): void;
  finish(): Promise<void>;
  cancel(): void;
}

type FrameScheduler = (callback: FrameRequestCallback) => number;
type FrameCanceller = (handle: number) => void;

export function createPatchDeltaPlayer(
  append: (delta: string) => void,
  scheduleFrame: FrameScheduler = window.requestAnimationFrame.bind(window),
  cancelFrame: FrameCanceller = window.cancelAnimationFrame.bind(window),
): PatchDeltaPlayer {
  const buffer: string[] = [];
  let opened = false;
  let finishing = false;
  let cancelled = false;
  let frameHandle: number | null = null;
  let finishFrameHandle: number | null = null;
  let finishPromise: Promise<void> | null = null;
  let resolveFinish: (() => void) | null = null;

  const completeIfReady = () => {
    if (
      !finishing
      || !opened
      || buffer.length > 0
      || frameHandle !== null
      || finishFrameHandle !== null
    ) return;
    finishFrameHandle = scheduleFrame(() => {
      finishFrameHandle = null;
      resolveFinish?.();
      resolveFinish = null;
    });
  };

  const schedule = () => {
    if (!opened || cancelled || frameHandle !== null || buffer.length === 0) {
      completeIfReady();
      return;
    }
    frameHandle = scheduleFrame(() => {
      frameHandle = null;
      if (cancelled) return;
      const count = Math.min(8, Math.max(1, Math.ceil(buffer.length / 24)));
      append(buffer.splice(0, count).join(""));
      schedule();
    });
  };

  return {
    push(delta) {
      if (!delta || cancelled || finishing) return;
      buffer.push(...Array.from(delta));
      schedule();
    },
    open() {
      if (cancelled) return;
      opened = true;
      schedule();
    },
    finish() {
      if (cancelled) return Promise.resolve();
      finishing = true;
      if (!finishPromise) {
        finishPromise = new Promise<void>((resolve) => {
          resolveFinish = resolve;
          completeIfReady();
        });
      }
      schedule();
      return finishPromise;
    },
    cancel() {
      cancelled = true;
      buffer.length = 0;
      if (frameHandle !== null) cancelFrame(frameHandle);
      if (finishFrameHandle !== null) cancelFrame(finishFrameHandle);
      frameHandle = null;
      finishFrameHandle = null;
      resolveFinish?.();
      resolveFinish = null;
    },
  };
}
