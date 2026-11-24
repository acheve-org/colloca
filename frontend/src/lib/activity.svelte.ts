/** A request must be pending this long before the indicator shows, so fast ones never flicker. */
export const BUSY_DELAY_MS = 300;

/** In-flight API requests; `busy` is true once they have been pending for BUSY_DELAY_MS. */
export const activity = $state<{ pending: number; busy: boolean }>({ pending: 0, busy: false });

// Plain counter: requests start inside $effects, which must not read the reactive state they write.
let count = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Marks a request as started; returns the function to call when it ends (success or failure). */
export function beginRequest(): () => void {
  count++;
  activity.pending = count;
  if (count === 1 && !timer) {
    timer = setTimeout(() => {
      timer = undefined;
      if (count > 0) activity.busy = true;
    }, BUSY_DELAY_MS);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    count = Math.max(0, count - 1);
    activity.pending = count;
    if (count === 0) {
      clearTimeout(timer);
      timer = undefined;
      activity.busy = false;
    }
  };
}

/** Forgets everything in flight (tests). */
export function resetActivity(): void {
  clearTimeout(timer);
  timer = undefined;
  count = 0;
  activity.pending = 0;
  activity.busy = false;
}
