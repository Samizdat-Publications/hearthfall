export const meta = {
  name: 'level-author',
  description: 'Author new Hearthfall campaign levels from briefs (data and scenarios), then adversarially check each one',
  whenToUse: 'ROADMAP Leg 7 (L7-B, L7-C): new campaign levels. Run only when Stewart asked for workflows in this session.',
  phases: [
    { title: 'Author', detail: 'one agent per batch of briefs: write the level, its bot scenario and idle scenario, measure and iterate' },
    { title: 'Check', detail: 'one skeptic per batch tries to refute each new level' },
  ],
}

// Hearthfall level authoring (S4 Leg 7). Main session usage:
//   Workflow({ scriptPath: 'tools/workflows/level-author.js', args: { briefs: [{ id, order, name, target, brief }], perAgent: 2 } })
//   target is the bot win tick the level aims for (band plus or minus 25 percent).
//   Afterwards: confirm no scenarios/zz_probe_* files remain, run the levels layer and npm run qa:fast,
//   review git status data/levels scenarios, commit, then run tools/workflows/campaign-playtest.js over the new
//   levels (fix round with the skeptic findings).
// Agents write only their own new level files, never commit, and never run the full suites (other agents'
// probe files sit in scenarios/ while the run is live).

const briefs = (args && args.briefs) || []
const perAgent = (args && args.perAgent) || 2
if (!briefs.length) throw new Error('pass args.briefs: [{ id, order, name, target, brief }, ...]')

const batches = []
for (let i = 0; i < briefs.length; i += perAgent) batches.push(briefs.slice(i, i + perAgent))
log(`${briefs.length} briefs in ${batches.length} batches of up to ${perAgent}`)

const RULES = `
Hard rules for this run (several agents work in parallel on other levels):
- Create or edit ONLY data/levels/<id>.json, scenarios/level_<id>.json and scenarios/level_<id>_idle_loses.json for your own level ids. No sim, ai, render, ui, data/base or tool code, no other level. No git commands that write (no add, commit, restore, stash).
- Run scenarios ONLY one at a time by id: node tools/harness/cli.mjs scenarios --id <id> (pass a Bash timeout of at most 540000 ms). NEVER run npm run test:scenarios, qa:fast, qa, check or e2e: other agents' temporary probe files are in scenarios/ and would break them.
- Temporary probe scenarios must be named scenarios/zz_probe_<levelid>_<n>.json with "id": "zz_probe_<levelid>_<n>". Delete every one you create before you return.
- Guards you may run: node tools/guards/dashes.mjs, node tools/guards/ip-names.mjs, node tools/guards/data.mjs. Text has no em or en dashes and no names from the original 90s god game. Every name and line of text is original.
- What levels can express: grep the "level scripting primitives" bullets in docs/DESIGN.md and read the level schema in packages/data/src/schemas.ts (grep LevelSchema and the objective, trigger, reward and map paint parts). validateLevel in packages/data/src/index.ts adds cross checks. If the brief needs something the engine cannot do, adapt the design inside what it can do and report the gap under engineGaps; never hack around it.
- Learn the file shapes from existing levels near your order: data/levels/ember_crown.json, data/levels/cloud_isles.json, data/levels/last_hearthfall.json, data/levels/hold_the_line.json, and their scenarios/level_<id>.json and scenarios/level_<id>_idle_loses.json. Set dressing: a level may place `props` (render only: a decor model id from data/base/style.json render.decor kinds, such as prop.cairn, prop.ruin_a, prop.standing_stone, prop.fence, prop.haystack, at a cell with optional rot and size); use a handful to make key places read (a ruined road, cairns by a shrine, a farmstead). A new level needs: a unique id equal to its file name, the given order, name, description (two or three plain sentences: the situation and the goal), a seed, a map (generator flat plus paint shapes is how the hand made maps are drawn), tribes (0 is the player), spells, setup, objectives, lose, and triggers and messages as the design needs.
`

const PROBE = `
How to measure the bot win timeline: copy scenarios/level_<id>.json to a probe file (keep its bots and commands), set runTicks to the level time limit (lose timeLimit seconds x 20) and replace assert with one entry per 1000 ticks: {"at": t, "expr": "level.objectivesDone == 99"}. Run it; stdout prints one failure line per assert with "(got N == 99)", the number of objectives done at tick t. The first tick where N equals the objective count (and level.won, check with a small probe if unsure) is the bot win tick. The idle scenario must lose.
`

const BRIEF = (b) => `
Level ${b.id} "${b.name}" (campaign order ${b.order}, chapter 3 "The Far Shores"):
${b.brief}
Pacing: the level bot wins near tick ${b.target} (plus or minus 25 percent). The time limit is at least 2x the bot win tick. Every stage asks for a decision or an action and takes the bot at least about 600 ticks; no padding (no stage that is only waiting or that the starting units finish untouched). Use at least 4 staged objectives (after chains). Objective text tells the player what to do in plain words.
`

const AUTHOR_SCHEMA = {
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          winTick: { type: 'number' },
          limitTicks: { type: 'number' },
          objectives: { type: 'array', items: { type: 'string' }, description: 'one line per objective: type and what it asks' },
          timeline: { type: 'string', description: 'objectivesDone per 1000 ticks, e.g. "1:0 2:1 3:1 ..."' },
          mechanics: { type: 'array', items: { type: 'string' }, description: 'the level mechanics used (map paint shapes, triggers, raids, stones, dens, tribe options)' },
          scenariosPass: { type: 'boolean', description: 'level_<id> and level_<id>_idle_loses both pass' },
          guardsPass: { type: 'boolean' },
          probesDeleted: { type: 'boolean' },
          engineGaps: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'winTick', 'limitTicks', 'objectives', 'timeline', 'mechanics', 'scenariosPass', 'guardsPass', 'probesDeleted', 'engineGaps', 'concerns'],
      },
    },
  },
  required: ['levels'],
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['ok', 'fix'] },
          verifiedWinTick: { type: 'number' },
          problems: { type: 'array', items: { type: 'string' }, description: 'concrete, with file and objective index; empty when ok' },
        },
        required: ['id', 'verdict', 'verifiedWinTick', 'problems'],
      },
    },
  },
  required: ['levels'],
}

const authorOne = (batch) => {
  const ids = batch.map((b) => b.id).join(', ')
  return agent(
    `You are authoring new Hearthfall campaign levels ${ids} in C:\\Users\\stewa\\Documents\\Claude\\Hearthfall. Stewart loves the campaign and wants more levels to play: make each one distinct, fair and fun, with a clear idea a player can feel in the first minute.
${RULES}${PROBE}
For each level: write the level data from its brief, write scenarios/level_<id>.json (the level bot plays tribe 0 and wins; asserts check the win and the key staged goals with margin in runTicks) and scenarios/level_<id>_idle_loses.json (an idle player loses), then measure the bot win timeline and iterate on the data (at most 5 rounds per level) until it meets the pacing target. Both scenarios must pass at the end.
${batch.map(BRIEF).join('\n')}
Return the structured result for every level in the batch, with honest numbers.`,
    { label: `author:${ids}`, phase: 'Author', schema: AUTHOR_SCHEMA },
  )
}

const checkOne = (authored, batch) => {
  if (!authored) return null
  const ids = batch.map((b) => b.id).join(', ')
  return agent(
    `You are a skeptical reviewer of brand new Hearthfall campaign levels ${ids} in C:\\Users\\stewa\\Documents\\Claude\\Hearthfall. The author claims:
${JSON.stringify(authored.levels, null, 1)}
${RULES}${PROBE}
Try to REFUTE each level. Read data/levels/<id>.json and its two scenarios. Re-measure the bot win tick yourself with your own probe (name it zz_probe_<levelid>_check_<n>). Look for: a level that does not match its brief, padding stages (pure waiting), a stage the bot or a player finishes instantly or that can never be done, a time limit under 2x the win, an idle scenario that does not really lose, scenario asserts too loose to catch a broken level, objective text that does not match the goal, a map where the player cannot reach what an objective needs, dashes or original-game names, a win tick far outside its target. Default to verdict "fix" when a claim does not reproduce. Do not edit any level or scenario file (read and probe only), and delete your probes.
${batch.map(BRIEF).join('\n')}`,
    { label: `check:${ids}`, phase: 'Check', schema: CHECK_SCHEMA },
  ).then((checked) => ({ authored, checked }))
}

const results = await pipeline(batches, authorOne, checkOne)
const authoredAll = []
const checkedAll = []
for (const r of results.filter(Boolean)) {
  if (r.authored) authoredAll.push(...r.authored.levels)
  if (r.checked) checkedAll.push(...r.checked.levels)
}
const missing = briefs.filter((b) => !checkedAll.some((c) => c.id === b.id)).map((b) => b.id)
if (missing.length) log(`no verified result for: ${missing.join(', ')}`)
return { authored: authoredAll, checked: checkedAll, missing }
