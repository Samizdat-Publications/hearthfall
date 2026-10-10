import { describe, expect, it } from "vitest";
import { soakRow, trendPanels, trendSvg } from "./history.mjs";

describe("BACKLOG 24 and 25: run history and trend charts", () => {
  it("soakRow keeps the balance numbers worth following per mode", () => {
    const results = [{ ok: true }, { ok: true }, { ok: false }, { ok: true }];
    const metrics = { seeds: 4, minutes: 20, orderFailed: 6, orderGaveUp: 2, drowned: 9, avgTickMs: 0.4, wins: { aggressive: 1, sneaky: 1, turtle: 2 }, stalemates: 1, medianMinutes: 14, waves: 10, wavesArrived: 7 };
    const r = soakRow("ai", metrics, results, "FAIL");
    expect(r).toMatchObject({ mode: "ai", matches: 4, clean: 3, result: "FAIL", failedPer10: 15, gaveUpPer10: 5, unfinishedPct: 25, medianMinutes: 14, wavesArrivedPct: 70 });
    expect(r.winShare).toEqual({ aggressive: 25, sneaky: 25, turtle: 50 });
    const d = soakRow("difficulty", { seeds: 2, minutes: 20, orderFailed: 0, orderGaveUp: 0, difficulty: { easy: { score: 0.2 }, brutal: { score: 0.8 } } }, [{ ok: true }], "PASS");
    expect(d.scores).toEqual({ easy: 0.2, brutal: 0.8 });
    expect(d.winShare).toBeUndefined();
    expect(soakRow("economy", { seeds: 1, minutes: 10, orderFailed: 0, orderGaveUp: 0, popMedian: 61 }, [], "PASS")).toMatchObject({ popMedian: 61, failedPer10: 0 });
  });

  it("trendPanels draws one panel group per recorded kind and skips missing ones", () => {
    expect(trendPanels([], [], [])).toEqual([]);
    const soak = [
      { mode: "ai", sha: "aaa", winShare: { aggressive: 40, sneaky: 30, turtle: 30 }, medianMinutes: 12, unfinishedPct: 5, failedPer10: 1, gaveUpPer10: 0 },
      { mode: "economy", sha: "aaa", popMedian: 60 },
      { mode: "ai", sha: "bbb+", winShare: { aggressive: 50, turtle: 50 }, medianMinutes: 13, unfinishedPct: 0, failedPer10: 0, gaveUpPer10: 0 },
    ];
    const p = trendPanels(soak, [{ sha: "aaa", tickAvgMs: 3, battleAvgMs: 5, tickP99Ms: 9 }], []);
    expect(p.map((x) => x.title.split(":")[0])).toEqual(["ai soak", "ai soak", "ai soak", "economy soak", "bench", "bench"]);
    expect(p[0].labels).toEqual(["aaa", "bbb+"]);
    expect(p[0].series.find((s) => s.label === "sneaky").values).toEqual([30, 0]);
    expect(p[3].labels).toEqual(["aaa"]);
  });

  it("trendSvg is one well-formed SVG with a line per series and gaps for missing values", () => {
    const svg = trendSvg("T <1>", [
      { title: "a & b", labels: ["x", "y", "z"], series: [{ label: "s", color: "#123456", values: [1, null, 3] }] },
      { title: "flat", labels: ["x"], series: [{ label: "one", color: "#654321", values: [2] }] },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("T &lt;1>");
    expect(svg).toContain("a &amp; b");
    // the null breaks the line: two separate moves, no line segment between them
    const path = svg.match(/<path d="([^"]+)" fill="none" stroke="#123456"/)[1];
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain("L");
    expect(svg.match(/<circle [^>]*fill="#123456"/g)).toHaveLength(2);
    expect(svg).not.toContain("NaN");
  });
});
