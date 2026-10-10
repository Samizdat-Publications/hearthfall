import { describe, expect, it } from "vitest";
import type { SimEvent } from "@hearthfall/sim";
import { orderNote } from "../src/orderNotes.ts";

const ev = (o: Record<string, unknown>) =>
  ({ tick: 1, ...o }) as unknown as SimEvent;

const yes = () => true;

describe("order feedback notes (BACKLOG 45)", () => {
  it("notes the local player's failed and abandoned orders", () => {
    expect(orderNote(ev({ type: "orderFailed", tribe: 0 }), 0, yes)?.key).toBe(
      "orderFailed",
    );
    expect(
      orderNote(ev({ type: "orderGaveUp", tribe: 0, chase: 0 }), 0, yes)?.key,
    ).toBe("orderGaveUp");
  });

  it("stays silent for rivals, combat chases and other events", () => {
    expect(orderNote(ev({ type: "orderFailed", tribe: 1 }), 0, yes)).toBeNull();
    expect(
      orderNote(ev({ type: "orderGaveUp", tribe: 0, chase: 1 }), 0, yes),
    ).toBeNull();
    expect(orderNote(ev({ type: "killed", tribe: 0 }), 0, yes)).toBeNull();
  });

  it("ignores units the player did not order (settlers on errands, combat acquisition)", () => {
    const ordered = (id: number) => id === 7;
    expect(
      orderNote(ev({ type: "orderFailed", tribe: 0, id: 9 }), 0, ordered),
    ).toBeNull();
    expect(
      orderNote(ev({ type: "orderFailed", tribe: 0, id: 7 }), 0, ordered)?.key,
    ).toBe("orderFailed");
  });
});
