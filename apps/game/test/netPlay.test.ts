// Leg 5 (L5-C): the in-app LAN lobby and match driver, against the real relay over sockets.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { makeBot } from "@hearthfall/ai";
import { Relay } from "../../../tools/net/relay.mjs";
import { coopParams, NET_DEFAULTS, NetPlay, parseStart, relayUrl, seatFilter, versusParams } from "../src/netPlay.ts";
import { createSkirmish, humansOf, type SkirmishParams } from "../src/session.ts";

const pack = loadBasePack().pack!;
const SP: SkirmishParams = { seed: 23, level: "continents", size: 96, tribes: 3, ai: ["aggressive", "sneaky"], difficulty: "normal" };
const tick = () => new Promise((r) => setTimeout(r, 1));

describe("L5-C: LAN play helpers", () => {
  it("versusParams seats the humans in the first tribes and keeps the setup's rivals", () => {
    const v = versusParams(SP, 2);
    expect(v.humans).toEqual([0, 1]);
    expect(v.tribes).toBe(3);
    expect(humansOf(v)).toEqual([0, 1]);
    expect(humansOf(SP)).toEqual([0]);
    expect(versusParams({ ...SP, tribes: 2, ai: ["aggressive"] }, 4).tribes).toBe(4);
  });

  it("seatFilter lets a seat command only its own tribe, and only the host send god-mode orders", () => {
    const f = seatFilter([0, 1]);
    expect(f({ tick: 5, tribe: 1, type: "move", args: {} }, 1)).toBeNull();
    expect(f({ tick: 5, tribe: 0, type: "move", args: {} }, 1)).toContain("own tribe");
    expect(f({ tick: 5, tribe: -1, type: "terrainOp", args: {} }, 0)).toBeNull();
    expect(f({ tick: 5, tribe: -1, type: "terrainOp", args: {} }, 1)).toContain("host only");
    expect(f({ tick: 5, tribe: 1, type: "move", args: {} }, 3)).not.toBeNull();
  });

  it("parseStart refuses a start message it cannot rebuild a world from", () => {
    expect(parseStart(versusParams(SP, 2))).not.toBeNull();
    expect(parseStart(null)).toBeNull();
    expect(parseStart({ ...SP })).toBeNull();
    expect(parseStart({ ...versusParams(SP, 2), seed: "x" })).toBeNull();
    expect(parseStart({ ...versusParams(SP, 2), humans: [0, "1"] })).toBeNull();
  });

  it("coopParams puts the seats on one team against every AI rival of the setup", () => {
    const c = coopParams(SP, 2);
    expect(c.tribes).toBe(4);
    expect(c.humans).toEqual([0, 1]);
    expect(c.teams).toEqual([0, 0, 1, 1]);
    expect(coopParams({ ...SP, tribes: 2, ai: ["aggressive"] }, 2).teams).toEqual([0, 0, 1]);
    expect(parseStart(c)).not.toBeNull();
    expect(parseStart({ ...c, teams: [0, 0, 1] })).toBeNull();
  });

  it("L5-E soak: two bot partners on one team against two AI tribes; allies never hurt each other and a team wins", () => {
    const p = coopParams({ ...SP, seed: 31, size: 128, rules: "conquest", ai: ["aggressive", "turtle"] }, 2);
    const w = createSkirmish(pack, p);
    expect(w.controllers.map((c) => c.tribe).sort()).toEqual([2, 3]);
    // the partners are bots in the human seats (as a test stand in for two people)
    for (const t of p.humans!) w.controllers.push(makeBot({ type: "opponent", tribe: t, personality: "sneaky", difficulty: "hard", offset: t }));
    let friendly = 0;
    let hostile = 0;
    const damage = w.damage.bind(w);
    w.damage = ((i: number, amount: number, by: number, ...rest: unknown[]) => {
      const tr = w.ents.tribe[i];
      if (by >= 0 && tr >= 0 && by !== tr) {
        if (w.allied(by, tr)) friendly++;
        else hostile++;
      }
      return (damage as (...a: unknown[]) => unknown)(i, amount, by, ...rest);
    }) as typeof w.damage;
    const end = 45 * 60 * w.cfg.tickHz;
    while (w.tick < end && w.rules!.winner < 0) w.step([]);
    expect(friendly).toBe(0);
    expect(hostile).toBeGreaterThan(0);
    expect(w.invariants()).toEqual([]);
    expect(w.rules!.winner).toBeGreaterThanOrEqual(0);
    const team = w.teamOf[w.rules!.winner];
    for (const t of w.tribes) if (w.teamOf[t.index] !== team) expect(t.alive).toBe(false);
  }, 300000);

  it("relayUrl sits next to the page", () => {
    expect(relayUrl({ protocol: "http:", host: "192.168.1.5:4173" })).toBe("ws://192.168.1.5:4173/net");
    expect(relayUrl({ protocol: "https:", host: "x.local" })).toBe("wss://x.local/net");
  });

  it("two pages host, join, start a versus skirmish and stay in step; a forged order is refused on both", async () => {
    const server = createServer((_q, r) => r.writeHead(404).end());
    new Relay().attach(server);
    const sockets = new Set<import("node:net").Socket>();
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/net`;
    const started: { p: SkirmishParams; tribe: number }[] = [];
    const lost: string[] = [];
    const page = () =>
      new NetPlay(new WebSocket(url), NET_DEFAULTS, {
        changed: () => {},
        started: (p, tribe) => started.push({ p, tribe }),
        lost: (why) => lost.push(why),
      });
    const host = page();
    const peer = page();
    try {
      host.host();
      for (let k = 0; k < 2000 && !host.client.code; k++) await tick();
      expect(host.state).toBe("lobby");
      expect(host.canStart()).toBe(false);
      peer.join(host.client.code.toLowerCase());
      for (let k = 0; k < 2000 && !host.canStart(); k++) await tick();
      expect(host.isHost).toBe(true);
      expect(peer.isHost).toBe(false);
      peer.start(SP); // only the host starts
      host.start(SP);
      for (let k = 0; k < 2000 && started.length < 2; k++) await tick();
      expect(started.map((s) => s.tribe).sort()).toEqual([0, 1]);
      const pages = [host, peer].map((n) => ({ n, w: createSkirmish(pack, n.params!), tribe: n.params!.humans![n.client.seat] }));
      expect(pages[0].w.hash().all).toBe(pages[1].w.hash().all);
      const END = 600;
      let forged = false;
      for (let frame = 0; frame < 20000 && pages.some((s) => s.n.ls!.tick < END); frame++) {
        for (const s of pages) {
          const ls = s.n.ls!;
          if (ls.tick % 5 === 0 && ls.tick % 50 < 5 && ls.tick < END) ls.local({ tribe: s.tribe, type: "move", args: { units: `tribe${s.tribe}.settlers`, to: [(ls.tick * 5) % 96, (ls.tick * 11) % 96] } });
          // the partner page forges an order for the host's tribe once
          if (s.tribe === 1 && ls.tick >= 100 && !forged && (forged = true)) ls.local({ tribe: 0, type: "move", args: { units: "tribe0.settlers", to: [1, 1] } });
          if (ls.tick < END) ls.advance(Math.min(5, END - ls.tick), (cmds) => s.w.step(cmds), () => s.w.hash().all);
        }
        await tick();
      }
      for (const s of pages) {
        expect(s.n.ls!.desync).toBeNull();
        expect(s.n.ls!.tick).toBe(END);
        expect(s.n.ls!.refused.map((r) => r[1])).toEqual([1]);
      }
      expect(pages[0].w.hash().all).toBe(pages[1].w.hash().all);
      // the partner leaves mid-match: the host hears it
      peer.leave();
      for (let k = 0; k < 2000 && !lost.length; k++) await tick();
      expect(lost).toEqual(["partnerLeft"]);
    } finally {
      host.leave();
      peer.leave();
      await new Promise<void>((r) => {
        server.close(() => r());
        for (const s of sockets) s.destroy();
      });
    }
  }, 60000);
});
