// Guard: PROMPT.md (the hackathon submission) must embed SABI_SYSTEM_PROMPT
// byte-for-byte, so what judges run is what the app runs.
//
//   pnpm check-prompt

import { readFileSync } from "node:fs";
import { SABI_SYSTEM_PROMPT } from "../lib/sabi-prompt";

const md = readFileSync("PROMPT.md", "utf8").replace(/\r\n/g, "\n");
const start = md.indexOf("```text\n");
const end = md.indexOf("\n```", start + 8);
if (start < 0 || end < 0) {
  console.error("PROMPT.md: could not find the ```text fenced prompt block");
  process.exit(1);
}
const embedded = md.slice(start + 8, end);
const expected = SABI_SYSTEM_PROMPT.replace(/\r\n/g, "\n");
if (embedded !== expected) {
  let k = 0;
  while (k < expected.length && expected[k] === embedded[k]) k++;
  console.error(`PROMPT.md prompt differs from lib/sabi-prompt.ts at char ${k}:`);
  console.error("  code:     " + JSON.stringify(expected.slice(k, k + 60)));
  console.error("  PROMPT.md:" + JSON.stringify(embedded.slice(k, k + 60)));
  process.exit(1);
}
console.log("PROMPT.md is in sync with SABI_SYSTEM_PROMPT ✓");
