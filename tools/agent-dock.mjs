#!/usr/bin/env node
// AGENT DOCK — Galen's directive: combine the worktree model with task
// create/claim/undock. One protocol: DOCKING.
//
//   dock:   stake the claim (commons [DOCK] line = the registry) AND spawn a
//           per-agent git worktree for it — the declarative section you work.
//   undock: commit inside the worktree, push its dock/ branch, remove the
//           worktree, release the claim ([UNDOCK] line). Merge-to-main is a
//           separate, reviewed act (a main-capable peer or Galen).
//
// Credit: the zero-race worktree recipe is claude-opus's (ENGINE ROOM); this
// tool welds it to the claim board so a claim and a workspace are ONE move.
//
//   node tools/agent-dock.mjs dock   <agent> <task words…>
//   node tools/agent-dock.mjs undock <agent> <slug> [commit message…]
//   node tools/agent-dock.mjs list
//
// Env: CAFE_PLAYER_KEY (to post the [DOCK]/[UNDOCK] lines). No key = git-only
// mode (worktree still made; post the claim yourself).

import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.CAFE_BASE || "https://cartridge.cafe";
const KEY = process.env.CAFE_PLAYER_KEY || "";
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, stdio: "pipe" }).toString().trim();

async function say(text) {
  if (!KEY) { console.log("(no CAFE_PLAYER_KEY — post this claim yourself):\n  " + text); return; }
  try {
    await fetch(BASE + "/api/engine/bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ type: "main_say", from: "agent-dock", text }),
    });
  } catch (e) { console.error("commons post failed:", e.message); }
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const [, , cmd, agent, ...rest] = process.argv;

if (cmd === "dock" && agent && rest.length) {
  const task = rest.join(" ");
  const slug = slugify(task);
  const branch = `dock/${agent}/${slug}`;
  const wt = join(REPO, "..", `cafe-dock-${agent}-${slug}`);
  if (existsSync(wt)) { console.error("already docked:", wt); process.exit(1); }
  sh(`git fetch -q origin main`);
  sh(`git worktree add -q -b ${branch} "${wt}" origin/main`);
  await say(`[DOCK] ${agent} claims "${task}" — working branch ${branch} in an isolated worktree. This section is docked; do not clobber. Undock releases it.`);
  console.log(`docked. work in: ${wt}\n  branch: ${branch}\n  undock: node tools/agent-dock.mjs undock ${agent} ${slug} "<commit msg>"`);
} else if (cmd === "undock" && agent && rest.length) {
  const slug = rest[0];
  const msg = rest.slice(1).join(" ") || `dock work: ${slug}`;
  const branch = `dock/${agent}/${slug}`;
  const wt = join(REPO, "..", `cafe-dock-${agent}-${slug}`);
  if (!existsSync(wt)) { console.error("no such dock:", wt); process.exit(1); }
  try { sh(`git add -A && git commit -q -m ${JSON.stringify(msg + "\n\nCo-Authored-By: " + agent + " (agent-dock)")}`, wt); }
  catch { console.log("(nothing new to commit in the worktree)"); }
  sh(`git push -q origin ${branch}`, wt);
  sh(`git worktree remove --force "${wt}"`);
  await say(`[UNDOCK] ${agent} releases "${slug}" — pushed ${branch}. Section free. A main-capable peer (or Galen) merges; review is the point of the seam.`);
  console.log(`undocked. branch pushed: ${branch} — awaiting merge to main.`);
} else if (cmd === "list") {
  console.log(sh("git worktree list"));
  try { console.log("\ndock branches:\n" + sh("git branch -r --list 'origin/dock/*'")); } catch { /* none */ }
} else {
  console.log("usage:\n  agent-dock.mjs dock <agent> <task words…>\n  agent-dock.mjs undock <agent> <slug> [commit msg…]\n  agent-dock.mjs list");
}
