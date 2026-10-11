export const meta = {
  name: 'campaign-playtest',
  description: 'Probe, tune (data only) and adversarially check every Hearthfall campaign level, then judge the campaign difficulty curve',
  whenToUse: 'PROGRESS Next action: campaign-wide playtest and balance pass. Run only when Stewart asked for a workflow or ultracode in this session.',
  phases: [
    { title: 'Tune', detail: 'one agent per batch of levels: probe the bot win timeline, retune data, re-verify' },
    { title: 'Check', detail: 'one skeptic per batch tries to refute each tuned level' },
    { title: 'Curve', detail: 'one critic reads every result and judges the whole campaign ramp' },
  ],
}

// Hearthfall campaign playtest (S3 Next action 3). Main session usage:
//   1. Build args with:
//      node -e "const fs=require('fs');console.log(JSON.stringify({levels:fs.readdirSync('data/levels').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync('data/levels/'+f,'utf8'))).sort((a,b)=>a.order-b.order).map(l=>({id:l.id,order:l.order})),perAgent:2}))"
//   2. Workflow({ scriptPath: 'tools/workflows/campaign-playtest.js', args: <that JSON> })
//   3. Afterwards: confirm no scenarios/zz_probe_* files remain, run npm run test:scenarios and npm run qa:fast,
//      review git diff data/levels scenarios, commit as S3: ..., update PROGRESS.
// Agents edit only their own level files, never commit, and never run the full suites (other agents' probe files
// sit in scenarios/ while the run is live).

const levels = (args && args.levels) || []
const perAgent = (args && args.perAgent) || 2
if (!levels.length) throw new Error('pass args.levels: [{id, order}, ...] (see the header comment)')
const total = levels.length
const lastOrder = Math.max(...levels.map((l) => l.order))

const batches = []
for (let i = 0; i < levels.length; i += perAgent) batches.push(levels.slice(i, i + perAgent))
log(`${total} levels in ${batches.length} batches of up to ${perAgent}`)

const target = (order) => Math.round(5000 + ((order - 1) / Math.max(1, lastOrder - 1)) * 29000)

const RULES = `
Hard rules for this run (several agents work in parallel on other levels):
- Edit ONLY data/levels/<id>.json and scenarios/level_<id>.json and scenarios/level_<id>_idle_loses.json for your own level ids. No sim, ai, render, ui or tool code. No git commands that write (no add, commit, restore, stash).
- Run scenarios ONLY one at a time by id: node tools/harness/cli.mjs scenarios --id <id> (pass a Bash timeout). NEVER run npm run test:scenarios, qa:fast, qa, check or e2e: other agents' temporary probe files are in scenarios/ and would break them.
- Temporary probe scenarios must be named scenarios/zz_probe_<levelid>_<n>.json with "id": "zz_probe_<levelid>_<n>". Delete every one you create before you return.
- Guards you may run: node tools/guards/dashes.mjs, node tools/guards/ip-names.mjs, node tools/guards/data.mjs. Text has no em or en dashes and no names from the original game.
- Read the "level scripting primitives" bullet in docs/DESIGN.md (grep it) and packages/data/src/schemas.ts (grep the level schema) for what levels can express. If a fix needs an engine change, do not hack around it: report it under engineGaps.
`

const PROBE = `
How to measure the bot win timeline for a level: copy scenarios/level_<id>.json to a probe file (keep its bots and commands), set runTicks to the level time limit (lose timeLimit seconds x 20) and replace assert with one entry per 1000 ticks: {"at": t, "expr": "level.objectivesDone == 99"}. Run it; stdout prints one failure line per assert with "(got N == 99)", which is the number of objectives done at tick t. The first tick where N equals the objective count (and level.won, check with a second small probe if unsure) is the bot win tick. The idle check is scenarios/level_<id>_idle_loses.json, which must still pass.
`

const PACING = (l) => `
Pacing targets for level ${l.id} (campaign order ${l.order} of ${lastOrder}):
- Bot win tick near ${target(l.order)} (band plus or minus 25 percent). The campaign ramps roughly linearly from about 5000 at level 1 to about 34000 at the last level. Stewart found the old levels far too easy, so when in doubt err long, but never by padding.
- The time limit is at least 2x the bot win tick (a human plays slower than the bot) and the idle scenario still loses.
- No padding: no stage that is only waiting (an absolute survive or a hold the bot finishes without contest). Each stage asks for a decision or an action and takes the bot at least about 600 ticks, except a level 1 to 3 tutorial step.
- Levels from order 8 up should use at least 4 staged objectives (after) and at least two of: stones (ley, ward, seer), wolves, prayer chains, holds, triggers, tides or causeways, a third tribe. Thin late levels (few objectives) must gain stages.
- Keep each level's theme, name and description idea; reword text to match new goals. Objective text tells the player what to do in plain words.
`

const TUNE_SCHEMA = {
  type: 'object',
  properties: {
    levels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          before: { type: 'object', properties: { winTick: { type: 'number' }, limitTicks: { type: 'number' }, objectives: { type: 'number' } }, required: ['winTick', 'limitTicks', 'objectives'] },
          after: { type: 'object', properties: { winTick: { type: 'number' }, limitTicks: { type: 'number' }, objectives: { type: 'number' } }, required: ['winTick', 'limitTicks', 'objectives'] },
          timeline: { type: 'string', description: 'objectivesDone per 1000 ticks after tuning, e.g. "1:0 2:1 3:1 ..." (k ticks : done)' },
          changes: { type: 'array', items: { type: 'string' }, description: 'one line per data change, with the reason' },
          scenariosPass: { type: 'boolean', description: 'level_<id> and level_<id>_idle_loses both pass after the change' },
          guardsPass: { type: 'boolean' },
          probesDeleted: { type: 'boolean' },
          engineGaps: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'before', 'after', 'timeline', 'changes', 'scenariosPass', 'guardsPass', 'probesDeleted', 'engineGaps', 'concerns'],
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

const tuneOne = (batch) => {
  const ids = batch.map((l) => l.id).join(', ')
  return agent(
    `You are tuning Hearthfall campaign levels ${ids} in C:\\Users\\stewa\\Documents\\Claude\\Hearthfall.
${RULES}${PROBE}
For each level: measure the current bot win timeline, then change the level data so it meets the pacing targets below, then measure again and iterate (at most 4 tuning rounds per level). Update scenarios/level_<id>.json so runTicks covers the new win with margin and its asserts still check the win and the staged goals; keep the idle scenario losing. Data-only levers: objectives (types, counts, seconds, after chains), tribes (ai, difficulty, maxTroops, worshipAfterSeconds), setup (units, buildings, sites, dens, stones), triggers, lose (timeLimit), map size and features if the schema allows.
${batch.map(PACING).join('\n')}
Return the structured result for every level in the batch, with honest numbers.`,
    { label: `tune:${ids}`, phase: 'Tune', schema: TUNE_SCHEMA },
  )
}

const checkOne = (tuned, batch) => {
  if (!tuned) return null
  const ids = batch.map((l) => l.id).join(', ')
  return agent(
    `You are a skeptical reviewer of freshly tuned Hearthfall campaign levels ${ids} in C:\\Users\\stewa\\Documents\\Claude\\Hearthfall. Another agent claims these results:
${JSON.stringify(tuned.levels, null, 1)}
${RULES}${PROBE}
Try to REFUTE each level. Read git diff -- data/levels/<id>.json scenarios/level_<id>*.json. Re-measure the bot win tick yourself with your own probe (name it zz_probe_<levelid>_check_<n>). Look for: padding stages (pure waiting), a stage the bot or a player finishes instantly or that can never be done, a time limit under 2x the win, an idle scenario that no longer loses or was weakened, scenario asserts loosened to pass, objective text that does not match the goal, dashes or original-game names, a win tick far outside its target. Default to verdict "fix" when a claim does not reproduce. Do not edit any level or scenario file (read and probe only), and delete your probes.
${batch.map(PACING).join('\n')}`,
    { label: `check:${ids}`, phase: 'Check', schema: CHECK_SCHEMA },
  ).then((checked) => ({ tuned, checked }))
}

const results = await pipeline(batches, tuneOne, checkOne)

phase('Curve')
const tunedAll = []
const checkedAll = []
for (const r of results.filter(Boolean)) {
  if (r.tuned) tunedAll.push(...r.tuned.levels)
  if (r.checked) checkedAll.push(...r.checked.levels)
}
const brief = tunedAll.map((t) => ({ id: t.id, before: t.before, after: t.after, gaps: t.engineGaps, concerns: t.concerns }))
const curve = await agent(
  `You judge the whole Hearthfall campaign difficulty ramp after a parallel tuning pass, in C:\\Users\\stewa\\Documents\\Claude\\Hearthfall. Do not edit files and do not run any scenarios (read only: git diff --stat, git diff -- data/levels, and the level JSON files).
Levels in order: ${levels.map((l) => `${l.order}:${l.id}`).join(' ')}.
Tuner claims (before and after): ${JSON.stringify(brief)}.
Skeptic verdicts and verified bot win ticks: ${JSON.stringify(checkedAll)}.
Report: whether the verified win ticks rise roughly monotonically from about 5000 to about 34000; levels out of order or out of band; mechanics that repeat too often or never appear; a short list of follow-up fixes ranked by value; and every engine gap worth building. Be concrete and brief.`,
  {
    label: 'curve',
    phase: 'Curve',
    schema: {
      type: 'object',
      properties: {
        monotone: { type: 'boolean' },
        outOfBand: { type: 'array', items: { type: 'string' } },
        followUps: { type: 'array', items: { type: 'string' } },
        engineGaps: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['monotone', 'outOfBand', 'followUps', 'engineGaps', 'summary'],
    },
  },
)

const missing = levels.filter((l) => !checkedAll.some((c) => c.id === l.id)).map((l) => l.id)
if (missing.length) log(`no verified result for: ${missing.join(', ')}`)
return { tuned: tunedAll, checked: checkedAll, curve, missing }
