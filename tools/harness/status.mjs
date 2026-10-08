#!/usr/bin/env node
// Prints the hours since run start (from docs/PROGRESS.md "Run started:") and whether a STOP file exists,
// for the end-of-turn STATUS line in CLAUDE.md.
import { existsSync, readFileSync } from "node:fs";
import { ROOT } from "../guards/lib.mjs";

const progress = readFileSync(ROOT + "docs/PROGRESS.md", "utf8");
const m = progress.match(/Run started:\s*(\d{4}-\d\d-\d\dT[\d:]+Z)/);
const h = m ? ((Date.now() - Date.parse(m[1])) / 3600000).toFixed(1) : "n/a";
console.log(`h:${h} | stop-file:${existsSync(ROOT + "STOP") ? "yes" : "no"}`);
