// @hearthfall/ai: deterministic controllers (opponents and test bots) using the Command API.
import type { Controller } from "@hearthfall/sim";
import { WanderBot } from "./wander.ts";
import { EconomyBot } from "./economyBot.ts";

export { WanderBot, type WanderOptions } from "./wander.ts";
export { EconomyBot, type EconomyBotOptions } from "./economyBot.ts";

/** Build a controller from a scenario or soak spec: {type: "wander", tribe, ...options}. */
export function makeBot(spec: { type: string; tribe: number; [k: string]: unknown }): Controller {
  switch (spec.type) {
    case "wander":
      return new WanderBot(spec as never);
    case "economy":
      return new EconomyBot(spec as never);
    default:
      throw new Error(`unknown bot type ${spec.type}`);
  }
}
