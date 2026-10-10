import { describe, expect, it } from "vitest";
import { bestThreshold, fitChecks } from "./run.mjs";

const row = (id, label, p) => ({ id, labels: { c: label }, answers: { c: { type: "probability", probability: p } } });
const CHECK = [{ id: "c", type: "probability" }];

describe("BACKLOG 43: VisionQA calibration holds out half the labeled set", () => {
  it("a separable check is trusted with a threshold between the classes", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(row(`pos${i}`, true, 0.8 + i * 0.02), row(`neg${i}`, false, 0.1 + i * 0.02));
    const r = fitChecks(rows, CHECK).c;
    expect(r.threshold).toBeGreaterThanOrEqual(0.25);
    expect(r.threshold).toBeLessThan(0.8);
    expect(r).toMatchObject({ accuracy: 1, fitAccuracy: 1, holdoutAccuracy: 1, n: 12, nHoldout: 6, advisory: false });
  });

  it("a threshold that only fits the fit half is caught by the held-out half", () => {
    // stratified order: negatives n0..n5 then positives p0..p5; even ranks fit, odd ranks are held out.
    // Held-out negatives answer high and held-out positives answer low, so the fit threshold misjudges them.
    const rows = [row("n0", false, 0.1), row("n1", false, 0.9), row("n2", false, 0.1), row("n3", false, 0.9), row("n4", false, 0.1), row("n5", false, 0.9), row("p0", true, 0.9), row("p1", true, 0.1), row("p2", true, 0.9), row("p3", true, 0.1), row("p4", true, 0.9), row("p5", true, 0.1)];
    const r = fitChecks(rows, CHECK).c;
    expect(r.fitAccuracy).toBe(1);
    expect(r.holdoutAccuracy).toBe(0);
    expect(r.advisory).toBe(true);
  });

  it("choice checks are scored over all rows, refusals are skipped, score checks are not calibrated", () => {
    const s = [
      { id: "a", labels: { k: "world_view", q: true }, answers: { k: { choice: "world_view" }, q: { type: "refusal" } } },
      { id: "b", labels: { k: "map_view" }, answers: { k: { choice: "world_view" } } },
    ];
    const r = fitChecks(s, [{ id: "k", type: "choice" }, { id: "q", type: "probability" }, { id: "z", type: "score" }]);
    expect(r.k).toEqual({ accuracy: 0.5, n: 2, advisory: true });
    expect(r.q).toBeUndefined();
    expect(r.z).toBeUndefined();
  });

  it("bestThreshold prefers the threshold nearest 0.5 among ties", () => {
    expect(bestThreshold([row("a", true, 0.95), row("b", false, 0.02)], "c").t).toBe(0.5);
  });
});
