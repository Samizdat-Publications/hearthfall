// @hearthfall/ai: deterministic controllers (opponents and test bots) using the Command API.
import type { BotSpec, Controller } from "@hearthfall/sim";
import { WanderBot } from "./wander.ts";
import { EconomyBot } from "./economyBot.ts";
import { WarBot } from "./warBot.ts";
import { OpponentAI } from "./opponent.ts";
import { RandomLegalBot, SpellSpammerBot, rusher, turtleBot } from "./testBots.ts";

export { WanderBot, type WanderOptions } from "./wander.ts";
export { EconomyBot, type EconomyBotOptions } from "./economyBot.ts";
export { WarBot, type WarBotOptions } from "./warBot.ts";
export { OpponentAI, PICKER_MOVES, type OpponentOptions, type OpponentState, type OpponentStats, type Personality } from "./opponent.ts";
export { RUSHER, TURTLE_BOT, RandomLegalBot, SpellSpammerBot, rusher, turtleBot } from "./testBots.ts";

/**
 * Build a controller from a scenario or soak spec: {type: "wander", tribe, ...options}. The controller keeps a
 * JSON copy as `botSpec` (BACKLOG 50), so a save or replay rebuilds exactly these controllers.
 */
export function makeBot(spec: BotSpec): Controller {
  return Object.assign(build(spec), { botSpec: JSON.parse(JSON.stringify(spec)) as BotSpec });
}

function build(spec: BotSpec): Controller {
  switch (spec.type) {
    case "wander":
      return new WanderBot(spec as never);
    case "economy":
      return new EconomyBot(spec as never);
    case "war":
      return new WarBot(spec as never);
    case "opponent":
      return new OpponentAI(spec as never);
    case "rusher":
      return rusher(spec);
    case "turtleBot":
      return turtleBot(spec);
    case "spellSpammer":
      return new SpellSpammerBot(spec);
    case "randomLegal":
      return new RandomLegalBot(spec);
    default:
      throw new Error(`unknown bot type ${spec.type}`);
  }
}
