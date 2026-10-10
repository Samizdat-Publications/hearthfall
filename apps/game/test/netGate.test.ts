// BACKLOG 46: god-mode commands and the debug hook are host only.
import { describe, expect, it } from "vitest";
import { COMMANDS, peerCommandRefusal } from "@hearthfall/sim";
import { debugApiAllowed } from "../src/netGate.ts";

describe("BACKLOG 46: host-only gates", () => {
  it("a peer may command only its own tribe, never tribe -1", () => {
    expect(COMMANDS.has("move")).toBe(true);
    expect(peerCommandRefusal({ tribe: 1, type: "move" }, 1)).toBeNull();
    expect(peerCommandRefusal({ tribe: -1, type: "move" }, 1)).toContain("host only");
    expect(peerCommandRefusal({ tribe: -1, type: "terrainOp" }, 0)).toContain("host only");
    expect(peerCommandRefusal({ tribe: 0, type: "move" }, 1)).toContain("own tribe");
    expect(peerCommandRefusal({ tribe: 1, type: "nope" }, 1)).toContain("unknown");
  });

  it("the debug hook needs the host role, then a test build or ?debug=1", () => {
    expect(debugApiAllowed(true, false, "host")).toBe(true);
    expect(debugApiAllowed(false, true, "host")).toBe(true);
    expect(debugApiAllowed(false, false, "host")).toBe(false);
    expect(debugApiAllowed(true, true, "peer")).toBe(false);
  });
});
