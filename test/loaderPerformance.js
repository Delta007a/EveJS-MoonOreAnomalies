"use strict";

// Run directly with Node. --baseline measures an unoptimized loader without
// enforcing the new bound. Server dependencies are fixtures; EveJS never starts.
const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const runtimeRoot = path.resolve(__dirname, "../../..");
const mods = { four: "fourModeAsteroidBelts", solo: "soloProgressionBalance", moon: "moonOreAnomalies" };
const baseline = process.argv.includes("--baseline");
const orderArg = process.argv.find((value) => value.startsWith("--order="));
function permutations(values) {
  return values.length < 2 ? [values] : values.flatMap((value, i) =>
    permutations(values.filter((_, j) => i !== j)).map((tail) => [value, ...tail]));
}
if (!orderArg) {
  for (const order of [...Object.keys(mods).map((name) => [name]), ...permutations(Object.keys(mods))]) {
    const child = spawnSync(process.execPath, [__filename, "--order=" + order.join(","), ...(baseline ? ["--baseline"] : [])], {
      encoding: "utf8", timeout: 60000,
    });
    assert.strictEqual(child.status, 0, child.stdout + child.stderr);
    console.log(child.stdout.trim());
  }
  console.log("PASS: three independent loaders and all six preload permutations");
} else {
  const order = orderArg.slice(8).split(",");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-loader-performance-"));
  const originalLoad = Module._load;
  const originalResolve = Module._resolveFilename;
  const originalRealpath = fs.realpathSync;
  const originalNative = fs.realpathSync.native;
  const originalCompile = Module.prototype._compile;
  let fourCompiles = 0;
  let calls = 0;
  let failCanonicalFor = null;
  function countedRealpath(...args) { calls++; return originalRealpath.apply(this, args); }
  countedRealpath.native = function (...args) {
    calls++;
    if (args[0] === failCanonicalFor) throw Object.assign(new Error("transient realpath fixture"), { code: "EACCES" });
    return originalNative.apply(this, args);
  };
  fs.realpathSync = countedRealpath;
  const targets = {
    four: path.join(runtimeRoot, "server/src/services/mining/miningRuntimeState.js"),
    solo: path.join(runtimeRoot, "server/src/services/mining/miningDogma.js"),
    moon: path.join(runtimeRoot, "server/src/services/dungeon/dungeonRuntime.js"),
  };
  Module.prototype._compile = function (source, filename) {
    if (filename === targets.four) fourCompiles++;
    return originalCompile.apply(this, arguments);
  };
  const fixtureKey = (filename) => process.platform === "win32" ? filename.toLowerCase() : filename;
  const fixtureAliases = new Map(Object.entries(targets).map(([name, filename]) => [fixtureKey(filename), name]));
  const soloExports = { buildMiningModuleSnapshot: () => ({ miningAmountM3: 100, moduleAttributes: { 77: 100 } }) };
  const moonExports = { getInstance: () => null, listInstancesByFamily: () => [], reconcileUniverseSeededInstances: () => ({}) };
  // Install the dependency boundary before the real hooks, so every test require
  // traverses the hooks. Four compiles the actual guarded target source.
  Module._load = function (request, parent, isMain) {
    if (Module.isBuiltin(request)) return originalLoad.apply(this, arguments);
    const filename = originalResolve(request, parent, isMain);
    const fixtureName = fixtureAliases.get(fixtureKey(filename));
    if (fixtureName === "solo") return soloExports;
    if (fixtureName === "moon") return moonExports;
    if (filename.startsWith(path.join(runtimeRoot, "server/src") + path.sep) && filename !== targets.four) {
      if (filename.endsWith("tableRepository.js")) return { createTableRepository: () => ({}) };
      return {};
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    process.env.EVEJS_SOLO_PROGRESSION_BALANCE = "1";
    process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL = "1";
    const states = {};
    for (const name of order) {
      const loader = require(path.join(runtimeRoot, "mods", mods[name], "loader.js"));
      states[name] = name === "moon" ? loader.install({
        runtimeRoot, config: { enabled: true, verbose: false }, systemIDs: [30000001],
      }) : name === "solo" ? loader.installResult : loader;
      assert.strictEqual(states[name].active, true);
    }
    const startupCalls = calls;
    const syncNames = ["statSync", "lstatSync", "accessSync", "existsSync", "readFileSync", "openSync", "readSync"];
    let steadySyncCalls = 0;
    const syncOriginals = new Map(syncNames.map((name) => [name, fs[name]]));
    for (const [name, original] of syncOriginals) fs[name] = function (...args) {
      steadySyncCalls++;
      return original.apply(this, args);
    };
    // Child-process isolation bounds instrumentation lifetime; restore before exit.
    process.once("exit", () => { for (const [name, original] of syncOriginals) fs[name] = original; });
    const measurements = {};
    function measure(name, request, verify = () => {}) {
      const first = require(request);
      verify(first);
      const warmupCalls = calls;
      const warmupSync = steadySyncCalls;
      for (let i = 0; i < 10000; i++) assert.strictEqual(require(request), first);
      const repeatedCalls = calls - warmupCalls;
      measurements[name] = { repeatedRequires: 10000, realpathCalls: repeatedCalls, otherSyncCalls: steadySyncCalls - warmupSync };
      if (!baseline) {
        assert.strictEqual(repeatedCalls, 0, name + " performs steady-state realpath");
        assert.strictEqual(steadySyncCalls - warmupSync, 0, name + " performs steady-state filesystem I/O");
      }
      verify(first);
    }
    measure("builtin", "node:path");
    const unrelated = path.join(root, "unrelated.js");
    fs.writeFileSync(unrelated, "module.exports = { unrelated: true };\n");
    measure("unrelated", unrelated, (value) => assert.strictEqual(value.unrelated, true));
    for (const name of order) measure(name + "Target", targets[name], (value) => {
      if (name === "four") assert.ok(value[Symbol.for("evejs.fourModeAsteroidBelts.miningBridge")]);
      if (name === "solo") {
        assert.ok(value[Symbol.for("evejs.soloProgressionBalance.overlayInstalled")]);
        assert.strictEqual(value.buildMiningModuleSnapshot({ characterID: 9 }).miningAmountM3, 300);
      }
      if (name === "moon") assert.ok(value[Symbol.for("evejs.moonOreAnomalies.presentationOverlay")]);
    });
    // Same basename in another directory must never acquire an overlay/transform.
    for (const name of Object.keys(targets)) {
      const filename = path.join(root, path.basename(targets[name]));
      fs.writeFileSync(filename, "module.exports = { unrelated: true };\n");
      measure(name + "Lookalike", filename, (value) => assert.deepStrictEqual(value, { unrelated: true }));
    }
    // Real Windows case variants and a real directory junction retain identity.
    if (process.platform === "win32") {
      for (const name of order) measure(name + "MixedCase", targets[name].toUpperCase().replaceAll("\\", "/"));
    }
    const junction = path.join(root, "alias");
    fs.symlinkSync(path.join(runtimeRoot, "server/src/services"), junction, process.platform === "win32" ? "junction" : "dir");
    for (const name of order) {
      const alias = path.join(junction, path.relative(path.join(runtimeRoot, "server/src/services"), targets[name]));
      fixtureAliases.set(fixtureKey(alias), name);
      assert.strictEqual(require(alias), require(targets[name]));
      measure(name + "Junction", alias);
    }
    // A failed canonicalization uses the existing lexical fallback, then retries.
    const transient = path.join(root, "transient.js");
    fs.writeFileSync(transient, "module.exports = 7;\n");
    require.resolve(transient);
    failCanonicalFor = transient;
    assert.strictEqual(require(transient), 7);
    failCanonicalFor = null;
    const beforeRetry = calls;
    assert.strictEqual(require(transient), 7);
    assert.ok(calls > beforeRetry, "failed realpath was incorrectly cached");
    measure("canonicalRetry", transient);
    // Identical raw requests from different parents must retain Node resolution.
    for (const name of ["left", "right"]) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "same.js"), "module.exports = " + JSON.stringify(name));
      const localRequire = Module.createRequire(path.join(dir, "parent.js"));
      assert.strictEqual(localRequire("./same"), name);
      assert.strictEqual(localRequire("./same"), name);
    }
    // A provisional failed resolution must neither be cached nor roll back Moon.
    const retry = path.join(root, "retry.js");
    assert.throws(() => require(retry), (error) => error.code === "MODULE_NOT_FOUND");
    fs.writeFileSync(retry, "module.exports = 42;\n");
    assert.strictEqual(require(retry), 42);
    if (states.moon) assert.strictEqual(states.moon.active, true);
    if (states.four) assert.strictEqual(fourCompiles, 1, "Four target compiled more than once");
    let sqliteProbeFailures = 0;
    if (states.moon) {
      Module._resolveFilename = function (request, parent, isMain, options) {
        try { return originalResolve.apply(this, arguments); }
        catch (error) {
          if (error.code === "MODULE_NOT_FOUND" && String(request).endsWith("better_sqlite3.node")) sqliteProbeFailures++;
          throw error;
        }
      };
      const serverRequire = Module.createRequire(path.join(runtimeRoot, "server/package.json"));
      const Database = serverRequire("better-sqlite3");
      const db = new Database(":memory:");
      try { assert.strictEqual(db.prepare("SELECT 42 AS answer").get().answer, 42); }
      finally { db.close(); }
      assert.ok(sqliteProbeFailures > 0, "native binding recovery probe did not run");
      assert.strictEqual(states.moon.active, true);
    }
    console.log(JSON.stringify({ order, startupCalls, measurements, retry: "PASS", junction: "PASS", sqliteProbeFailures }));
  } finally {
    Module._load = originalLoad;
    Module.prototype._compile = originalCompile;
    Module._resolveFilename = originalResolve;
    fs.realpathSync = originalRealpath;
    // The only recursive removal is the exact directory created by mkdtemp above.
    assert.strictEqual(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("evejs-loader-performance-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
