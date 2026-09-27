import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../src/graph/concurrency.js";

/** A promise plus the function that resolves it, for driving completion order by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("mapWithConcurrency", () => {
  it("returns results in input order even when later items finish first", async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const running = mapWithConcurrency([0, 1, 2], 3, (i) => gates[i]!.promise);

    gates[2]!.resolve("c");
    gates[0]!.resolve("a");
    gates[1]!.resolve("b");

    expect(await running).toEqual(["a", "b", "c"]);
  });

  it("never runs more than `limit` calls at once, and keeps `limit` busy while work remains", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    let inFlight = 0;
    let maxInFlight = 0;

    const running = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[i]!.promise;
      inFlight -= 1;
    });

    await flush();
    expect(inFlight).toBe(2);

    gates[0]!.resolve();
    await flush();
    expect(inFlight).toBe(2);

    for (const gate of gates) gate.resolve();
    await running;
    expect(maxInFlight).toBe(2);
  });

  it("passes each item's index to the callback", async () => {
    const result = await mapWithConcurrency(["a", "b"], 2, async (item, index) => `${item}${index}`);

    expect(result).toEqual(["a0", "b1"]);
  });

  it("returns an empty array for no items without calling the callback", async () => {
    let calls = 0;

    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1;
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects if a callback rejects, rather than swallowing the failure", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      }),
    ).rejects.toThrow("boom");
  });

  it("treats a limit below 1 as 1 instead of never starting", async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (i) => i * 10)).toEqual([10, 20]);
  });
});
