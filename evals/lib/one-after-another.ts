/**
 * The runs of one purchase eval go one after another, never at the same time, and no more than two purchase chats run
 * at once in all.
 *
 * The daily run sends each cart and checkout eval three times (`--repeat 3`). eve starts the three runs of an eval side
 * by side, with the same product, store and address. A supplier that prices one order at a time at a store then makes
 * the second and third runs wait in line behind the first: on 2026-11-27 Wayfair took 4.4, 9.2 and 12.4 minutes for its
 * three runs, and the later ones ran out of time through no fault of Agentcard's or the store's.
 *
 * Store sign-ins and checkouts run in hosted browsers, and on 2026-11-27 sign-ins failed when several ran at the same
 * time. So at most `chatsAtOnce()` purchase chats run at once (two, or `PURCHASE_CHATS_AT_ONCE`), whatever eve's own
 * `--max-concurrency`.
 *
 * Every purchase eval runs its chat through `oneAfterAnother`, with the eval's own name as the key: a run starts once
 * the run before it of the same eval has ended and a chat's place is free. A run that hangs holds the others back no
 * longer than its own time limit.
 *
 * eve gives each run its time limit from the moment it starts waiting, so a purchase eval's limit is its own limit times
 * the most runs that may go before it (`limitFor`).
 */

const last = new Map<string, Promise<void>>();

/** How many purchase chats may run at once: `PURCHASE_CHATS_AT_ONCE`, or two. */
export function chatsAtOnce(env: NodeJS.ProcessEnv = process.env): number {
  const count = Number(env.PURCHASE_CHATS_AT_ONCE);
  return Number.isInteger(count) && count >= 1 ? count : 2;
}

let running = 0;
const queue: (() => void)[] = [];

/** Waits for a chat's place, and returns the function that gives it back. Giving it back twice gives it back once. */
async function place(): Promise<() => void> {
  if (running < chatsAtOnce()) running++;
  else await new Promise<void>((resolve) => queue.push(resolve));
  let given = false;
  return () => {
    if (given) return;
    given = true;
    const next = queue.shift();
    // The place goes straight to the next run waiting, so the count never drops below what is running.
    if (next) next();
    else running--;
  };
}

/**
 * Runs `run` once every earlier run with the same key has ended, or has run for `limitMs`, and a chat's place is free.
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
  const giveBack = await place();
  const done = () => {
    giveBack();
    release();
  };
  // A run that hangs past its own limit lets the others start. The timer never keeps the process alive.
  const timer = setTimeout(done, limitMs);
  timer.unref?.();
  try {
    return await run();
  } finally {
    clearTimeout(timer);
    done();
  }
}

/** The number after a flag on the command line, such as `--repeat 3` or `--repeat=3`, or undefined. */
function flag(argv: readonly string[], name: string): number | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = arg === name ? argv[index + 1] : arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;
    const count = Number(value);
    if (value !== undefined && Number.isInteger(count) && count >= 1) return count;
  }
  return undefined;
}

/**
 * How many times this run sends each eval: the number after `--repeat` on the command line, or 1. The evals run in the
 * same process as eve's command, so its arguments are this process's.
 */
export function repeats(argv: readonly string[] = process.argv): number {
  return flag(argv, "--repeat") ?? 1;
}

/**
 * The time limit eve gives a purchase eval's run: its own limit for each run that may go before it. That is the earlier
 * runs of the same eval, or every run eve holds at once (`--max-concurrency`, 4 in evals.config.ts) when that is more,
 * since only `chatsAtOnce()` of them chat at a time.
 */
export function limitFor(ownLimitMs: number, argv: readonly string[] = process.argv): number {
  return ownLimitMs * Math.max(repeats(argv), flag(argv, "--max-concurrency") ?? 4);
}
