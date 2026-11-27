/**
 * The runs of one purchase eval go one after another, never at the same time.
 *
 * The daily run sends each cart and checkout eval three times (`--repeat 3`). eve starts the three runs of an eval side
 * by side, with the same product, store and address. A supplier that prices one order at a time at a store then makes
 * the second and third runs wait in line behind the first: on 2026-11-27 Wayfair took 4.4, 9.2 and 12.4 minutes for its
 * three runs, and the later ones ran out of time through no fault of Agentcard's or the store's.
 *
 * So every purchase eval runs its chat through `oneAfterAnother`, with the eval's own name as the key: a run starts once
 * the run before it of the same eval has ended. Runs of different evals still go side by side. A run that hangs holds the
 * next one back no longer than its own time limit.
 *
 * eve gives each run its time limit from the moment it starts waiting, so a purchase eval's limit is its own limit times
 * the number of runs (`limitFor`). The daily run lets more runs wait at once (`--max-concurrency` in modal_app.py), since
 * a run waiting its turn uses nothing.
 */

const last = new Map<string, Promise<void>>();

/**
 * Runs `run` once every earlier run with the same key has ended, or has run for `limitMs`, whichever comes first.
 * Returns what `run` returns.
 */
export async function oneAfterAnother<T>(key: string, limitMs: number, run: () => Promise<T>): Promise<T> {
  const before = last.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  last.set(key, mine);
  await before;
  // A run that hangs past its own limit lets the next one start. The timer never keeps the process alive.
  const timer = setTimeout(release, limitMs);
  timer.unref?.();
  try {
    return await run();
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * How many times this run sends each eval: the number after `--repeat` on the command line, or 1. The evals run in the
 * same process as eve's command, so its arguments are this process's.
 */
export function repeats(argv: readonly string[] = process.argv): number {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = arg === "--repeat" ? argv[index + 1] : arg.startsWith("--repeat=") ? arg.slice("--repeat=".length) : undefined;
    const count = Number(value);
    if (value !== undefined && Number.isInteger(count) && count >= 1) return count;
  }
  return 1;
}

/** The time limit eve gives a purchase eval's run: its own limit for each run of the same eval that may go before it. */
export function limitFor(ownLimitMs: number, argv: readonly string[] = process.argv): number {
  return ownLimitMs * repeats(argv);
}
