// M10 audio: mixing decisions (buses, volume curve, wrap-aware spatial falloff and pan), the music
// director, cue aliases, and which sim cues the shipped clips cover.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AudioHooks, busGain, busOf, MusicDirector, spatial, type Listener } from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url);
const style = JSON.parse(readFileSync(new URL("data/base/style.json", ROOT), "utf8"));
const spells = JSON.parse(readFileSync(new URL("data/base/spells.json", ROOT), "utf8"));
const clips = new Set(readdirSync(new URL("assets/audio/", ROOT)).filter((f) => f.endsWith(".ogg")).map((f) => f.replace(/\.ogg$/, "")));

describe("audio mix", () => {
  it("routes cues to buses and squares the volume sliders", () => {
    expect([busOf("music.calm"), busOf("voice.shaper.casting"), busOf("sfx.born")]).toEqual(["music", "voice", "sfx"]);
    expect(busGain({ master: 100, music: 100, sfx: 50 }, "sfx")).toBeCloseTo(0.25);
    expect(busGain({ master: 50, music: 100, sfx: 100 }, "music")).toBeCloseTo(0.25);
    expect(busGain({ master: 0, music: 100, sfx: 100 }, "voice")).toBe(0);
  });

  it("attenuates by wrap-aware distance and pans by side", () => {
    const l: Listener = { x: 2, z: 2, size: 128, radius: 40 };
    expect(spatial(l, undefined, undefined)).toEqual({ gain: 1, pan: 0 });
    expect(spatial(l, 4, 2).gain).toBe(1);
    // across the seam: (126, 2) is 4 cells away, not 124
    expect(spatial(l, 126, 2).gain).toBe(1);
    expect(spatial(l, 2, 60).gain).toBe(0);
    const mid = spatial(l, 2 + 25, 2);
    expect(mid.gain).toBeGreaterThan(0);
    expect(mid.gain).toBeLessThan(1);
    expect(mid.pan).toBeGreaterThan(0);
    expect(spatial(l, 2 - 25, 2).pan).toBeLessThan(0);
  });

  it("the music director goes to battle at once and steps down only after the hold", () => {
    const d = new MusicDirector(24, 15, 35, 20);
    const l: Listener = { x: 10, z: 10, size: 128, radius: 60 };
    expect(d.update(0, [], l, 0)).toBe("calm");
    // fighting far away: tension
    expect(d.update(1, [{ type: "melee", x: 80, y: 80 }], l, 0)).toBe("tension");
    // fighting near the camera: battle at once
    expect(d.update(2, [{ type: "melee", x: 12, y: 10 }], l, 0)).toBe("battle");
    // battle window over, but the stem holds 20 s from when it started
    expect(d.update(18, [], l, 0)).toBe("battle");
    expect(d.update(23, [], l, 0)).toBe("tension");
    expect(d.update(50, [], l, 0)).toBe("calm");
    // an own raid is not a threat; a rival raid is
    expect(d.update(80, [{ type: "raid", tribe: 0 }], l, 0)).toBe("calm");
    expect(d.update(81, [{ type: "raid", tribe: 1 }], l, 0)).toBe("tension");
  });

  it("aliases map a cue to the clip that serves it", () => {
    const played: string[] = [];
    const h = new AudioHooks({ spellCast: { cue: "sfx.{spell}_cast" } }, new Set(["sfx.quake"]), (p) => played.push(p.cue), { "sfx.quake_cast": "sfx.quake" });
    h.consume([{ type: "spellCast", tick: 1, spell: "quake" }]);
    expect(played).toEqual(["sfx.quake"]);
  });

  it("every alias names a shipped clip, and the shipped clips cover the cue table except a known list", () => {
    const alias: Record<string, string> = style.audio.alias;
    for (const [cue, clip] of Object.entries(alias)) expect(clips.has(clip), `${cue} -> ${clip}`).toBe(true);
    const cues = new Set<string>();
    for (const r of Object.values(style.audio.cues) as { cue: string }[]) {
      if (r.cue.includes("{spell}")) for (const s of spells.spells) cues.add(r.cue.replace("{spell}", s.id));
      else cues.add(r.cue);
    }
    const silent = [...cues].map((c) => alias[c] ?? c).filter((c) => !clips.has(c)).sort();
    // every live spell sounds (spells without their own clip borrow one by alias); no clip yet, logged
    // in docs/ASSETS.md as placeholders: chant, chant break, conversion, training, elimination
    expect(silent).toEqual(["sfx.chant", "sfx.chant_break", "sfx.converted", "sfx.eliminated", "sfx.trained"]);
    for (const m of ["music.calm", "music.tension", "music.battle"]) expect(clips.has(m)).toBe(true);
  });
});
