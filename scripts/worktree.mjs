#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const DEFAULT_PRIMARY_ROOT = "/Users/alex/Documents/thriftly-chrome-extension";
const LEGACY_WORKTREE_ROOT = "/Users/alex/Documents/scouted-worktrees";
const TEMP_WORKTREE_ROOT = "/private/tmp/scouted-worktrees";
const DEFAULT_WORKTREE_ROOT = process.env.SCOUTED_WORKTREE_ROOT || TEMP_WORKTREE_ROOT;

function main() {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case "new":
        return createWorktree(args);
      case "list":
        return listWorktrees();
      case "done":
        return removeWorktree(args);
      case "cleanup":
        return cleanupWorktrees(args);
      case "guard":
        return guardCommit();
      case "install-hooks":
        return installHooks();
      case "help":
      case undefined:
        return printHelp();
      default:
        fail(`Unknown command: ${command}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function createWorktree(args) {
  const options = parseOptions(args);
  const rawName = options.positionals[0];
  if (!rawName) fail("Usage: npm run chat:new -- <task-name>");

  const slug = slugify(rawName);
  const branch = options.branch || `codex/${slug}`;
  const base = options.from || preferredMainRef();
  const worktreeRoot = options.root || DEFAULT_WORKTREE_ROOT;
  const destination = path.resolve(worktreeRoot, slug);

  if (fs.existsSync(destination)) {
    fail(`Worktree path already exists: ${destination}`);
  }
  if (branchExists(branch)) {
    fail(`Branch already exists: ${branch}`);
  }

  ensureDirectory(worktreeRoot);
  runGit(["fetch", "origin"], { optional: true });
  runGit(["worktree", "add", "-b", branch, destination, base]);
  linkEnvFile(destination);

  console.log(`Created worktree: ${destination}`);
  console.log(`Branch: ${branch}`);
  console.log(`Base: ${base}`);
  console.log("");
  console.log(`Next: cd ${shellQuote(destination)}`);
}

function listWorktrees() {
  const worktrees = getWorktrees();
  const goneBranches = new Set(remoteGoneBranches());

  for (const worktree of worktrees) {
    const status = git(["-C", worktree.path, "status", "--short", "--branch"], { optional: true }).stdout.trim();
    const branch = worktree.branch || "(detached)";
    const markers = [];
    if (goneBranches.has(branch)) markers.push("remote gone");
    if (isCompletedBranch(branch)) markers.push("merged");
    if (!isClean(worktree.path)) markers.push("dirty");

    console.log(worktree.path);
    console.log(`  branch: ${branch}`);
    console.log(`  head:   ${worktree.head}`);
    if (markers.length) console.log(`  flags:  ${markers.join(", ")}`);
    if (status) {
      for (const line of status.split("\n")) console.log(`  ${line}`);
    }
    console.log("");
  }
}

function removeWorktree(args) {
  const options = parseOptions(args);
  const target = options.positionals[0];
  if (!target) fail("Usage: npm run chat:done -- <task-name|branch|path>");

  const worktree = findWorktree(target);
  if (!worktree) fail(`No matching worktree found for: ${target}`);
  if (isPrimaryRoot(worktree.path)) fail("Refusing to remove the primary project directory.");
  if (isProtectedBranch(worktree.branch)) {
    fail(`Refusing to remove worktree on protected branch ${worktree.branch}. Switch that worktree to a feature branch first.`);
  }
  if (!isClean(worktree.path) && !options.force) {
    fail(`Worktree is dirty: ${worktree.path}\nCommit, stash, or rerun with --force if you intentionally want to remove it.`);
  }

  const branch = worktree.branch;
  const merged = isCompletedBranch(branch);
  if (!merged && !options.force) {
    fail(`Branch is not merged into main: ${branch}\nMerge it first, or rerun with --force if you intentionally want to keep/delete it manually.`);
  }

  runGit(["worktree", "remove", worktree.path, ...(options.force ? ["--force"] : [])]);

  if (branch && branch !== "main" && branch !== "master" && branchExists(branch)) {
    const deleteArgs = isMergedIntoMain(branch) ? ["branch", "-d", branch] : ["branch", "-D", branch];
    runGit(deleteArgs);
  }

  console.log(`Removed worktree: ${worktree.path}`);
  if (branch) console.log(`Removed branch: ${branch}`);
}

function cleanupWorktrees(args) {
  const options = parseOptions(args);
  const apply = Boolean(options.apply);
  const candidates = getWorktrees().filter((worktree) => {
    if (isPrimaryRoot(worktree.path)) return false;
    if (isProtectedBranch(worktree.branch)) return false;
    if (!isManagedWorktreePath(worktree.path)) return false;
    if (!isClean(worktree.path)) return false;
    return isCompletedBranch(worktree.branch);
  });

  if (!candidates.length) {
    console.log("No clean merged managed worktrees to clean up.");
    return;
  }

  if (!apply) {
    console.log("Dry run. These clean merged managed worktrees can be removed:");
    for (const worktree of candidates) {
      console.log(`  ${worktree.branch} -> ${worktree.path}`);
    }
    console.log("");
    console.log("Run `npm run chat:cleanup -- --apply` to remove them.");
    return;
  }

  for (const worktree of candidates) {
    runGit(["worktree", "remove", worktree.path]);
    if (worktree.branch && branchExists(worktree.branch) && isCompletedBranch(worktree.branch)) {
      const deleteArgs = isMergedIntoMain(worktree.branch) ? ["branch", "-d", worktree.branch] : ["branch", "-D", worktree.branch];
      runGit(deleteArgs);
    }
    console.log(`Removed ${worktree.branch} -> ${worktree.path}`);
  }
}

function guardCommit() {
  const root = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  const branch = currentBranch(root);
  const stagedFiles = changedFiles(root, ["diff", "--cached", "--name-only"]);

  if (!stagedFiles.length) return;

  const errors = [];
  if (isPrimaryRoot(root) && branch !== "main" && process.env.ALLOW_PRIMARY_WORKTREE_COMMIT !== "true") {
    errors.push(`Primary project folder is on feature branch ${branch}. Create a worktree with \`npm run chat:new -- <task>\` and commit there.`);
  }

  if ((branch === "main" || branch === "master") && process.env.ALLOW_MAIN_COMMIT !== "true") {
    errors.push("Direct commits to main are blocked. Create a feature worktree/branch first.");
  }

  if (remoteGoneBranches(root).includes(branch)) {
    errors.push(`Current branch ${branch} no longer has a remote branch. Start a fresh branch from main.`);
  }

  if (hasRef("origin/main", root) && !isAncestor("origin/main", "HEAD", root)) {
    errors.push("Current branch does not contain origin/main. Rebase or recreate the branch from current main before committing.");
  }

  const unstagedFiles = new Set(changedFiles(root, ["diff", "--name-only"]));
  const overlapping = stagedFiles.filter((file) => unstagedFiles.has(file));
  if (overlapping.length) {
    errors.push(`These files have both staged and unstaged changes: ${overlapping.join(", ")}. Split the work into separate worktrees or commit only from a clean file state.`);
  }

  if (errors.length) {
    console.error("Worktree guard blocked this commit:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
}

function installHooks() {
  const hookPath = git(["rev-parse", "--git-path", "hooks/pre-commit"]).stdout.trim();
  ensureDirectory(path.dirname(hookPath));
  const script = [
    "#!/bin/sh",
    "npm run worktree:guard",
    "",
  ].join("\n");
  fs.writeFileSync(hookPath, script, { mode: 0o755 });
  console.log(`Installed pre-commit hook: ${hookPath}`);
}

function printHelp() {
  console.log(`Usage:
  npm run chat:new -- <task-name> [--from <ref>] [--branch <branch>] [--root <path>]
  npm run chat:list
  npm run chat:done -- <task-name|branch|path>
  npm run chat:cleanup [-- --apply]
  npm run hooks:install

The chat:* commands are aliases for worktree:* commands.`);
}

function parseOptions(args) {
  const options = { positionals: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--from") options.from = args[++index];
    else if (arg === "--branch") options.branch = args[++index];
    else if (arg === "--root") options.root = args[++index];
    else options.positionals.push(arg);
  }
  return options;
}

function getWorktrees() {
  const output = git(["worktree", "list", "--porcelain"]).stdout;
  const worktrees = [];
  let current = null;

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current = { path: value, head: "", branch: "" };
    else if (current && key === "HEAD") current.head = value;
    else if (current && key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
  }
  if (current) worktrees.push(current);
  return worktrees;
}

function findWorktree(target) {
  const slug = slugify(target);
  return getWorktrees().find((worktree) => {
    const branch = worktree.branch || "";
    return worktree.path === target ||
      path.basename(worktree.path) === target ||
      path.basename(worktree.path) === slug ||
      branch === target ||
      branch === `codex/${target}` ||
      branch === `codex/${slug}`;
  });
}

function currentBranch(cwd = process.cwd()) {
  return git(["-C", cwd, "branch", "--show-current"]).stdout.trim();
}

function preferredMainRef() {
  return hasRef("origin/main") ? "origin/main" : "main";
}

function branchExists(branch) {
  return hasRef(branch);
}

function hasRef(ref, cwd = process.cwd()) {
  const result = git(["-C", cwd, "rev-parse", "--verify", "--quiet", ref], { optional: true });
  return result.status === 0;
}

function isMergedIntoMain(branch) {
  if (!branch || branch === "main" || branch === "master") return true;
  const mainRef = preferredMainRef();
  return isAncestor(branch, mainRef);
}

function isCompletedBranch(branch) {
  if (!branch || isProtectedBranch(branch)) return true;
  return isMergedIntoMain(branch) || isMergedPullRequestBranch(branch);
}

function isProtectedBranch(branch) {
  return branch === "main" || branch === "master";
}

function isMergedPullRequestBranch(branch) {
  const result = spawnSync("gh", ["pr", "view", branch, "--json", "state,mergedAt"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return false;

  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.state === "MERGED" || Boolean(parsed.mergedAt);
  } catch {
    return false;
  }
}

function isAncestor(ancestor, descendant, cwd = process.cwd()) {
  return git(["-C", cwd, "merge-base", "--is-ancestor", ancestor, descendant], { optional: true }).status === 0;
}

function isClean(cwd) {
  return git(["-C", cwd, "status", "--porcelain"], { optional: true }).stdout.trim() === "";
}

function changedFiles(cwd, args) {
  const output = git(["-C", cwd, ...args], { optional: true }).stdout.trim();
  return output ? output.split("\n").filter(Boolean) : [];
}

function remoteGoneBranches(cwd = process.cwd()) {
  const output = git(["-C", cwd, "branch", "-vv"], { optional: true }).stdout;
  return output
    .split("\n")
    .filter((line) => line.includes(": gone]"))
    .map((line) => line.replace(/^[*+ ]+/, "").split(/\s+/)[0])
    .filter(Boolean);
}

function linkEnvFile(destination) {
  const sourceRoot = fs.existsSync(DEFAULT_PRIMARY_ROOT) ? DEFAULT_PRIMARY_ROOT : process.cwd();
  const sourceEnv = path.join(sourceRoot, ".env.local");
  const destinationEnv = path.join(destination, ".env.local");
  if (!fs.existsSync(sourceEnv) || fs.existsSync(destinationEnv)) return;

  try {
    fs.symlinkSync(sourceEnv, destinationEnv);
    console.log(`Linked .env.local from ${sourceEnv}`);
  } catch {
    console.warn(`Could not link .env.local. If needed, copy it from ${sourceEnv}.`);
  }
}

function isPrimaryRoot(rootPath) {
  return path.resolve(rootPath) === path.resolve(DEFAULT_PRIMARY_ROOT);
}

function isManagedWorktreePath(worktreePath) {
  const resolved = path.resolve(worktreePath);
  return resolved.startsWith(path.resolve(DEFAULT_WORKTREE_ROOT) + path.sep) ||
    resolved.startsWith(path.resolve(TEMP_WORKTREE_ROOT) + path.sep) ||
    resolved.startsWith(path.resolve(LEGACY_WORKTREE_ROOT) + path.sep) ||
    resolved.startsWith("/private/tmp/scouted-") ||
    resolved.startsWith(path.join(os.tmpdir(), "scouted-"));
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runGit(args, options = {}) {
  const result = git(args, options);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  return result;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!options.optional && result.status !== 0) {
    const command = `git ${args.join(" ")}`;
    const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(`${command} failed${detail ? `:\n${detail}` : ""}`);
  }

  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
