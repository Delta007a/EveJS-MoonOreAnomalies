"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { isMainThread } = require("node:worker_threads");

const configModule = require("./config");
const contentOverlay = require("./lib/contentOverlay");
const lifecycleRetirement = require("./lib/lifecycleRetirement");
const moonRules = require("./lib/moonRules");
const presentationOverlay = require("./lib/presentationOverlay");
const { API_SYMBOL, createRuntimeApi } = require("./lib/runtimeApi");
const scanStrengthOverlay = require("./lib/scanStrengthOverlay");
const sourceTransforms = require("./lib/sourceTransforms");
const viability = require("./lib/viability");
const snapshots = require("./data/moonOreTemplates.v1.json");

const MOD_VERSION = "0.5.8";
// Advancing the loader release must not rotate accepted Moon instances.
// This revision is embedded in populationHints and therefore in templateContentHash.
const TEMPLATE_CONTENT_REVISION = "0.2.0";
const MOD_DIR = __dirname;
const INSTALL_MARKER = Symbol.for("evejs.moonOreAnomalies.install");
const API_MARKER = Symbol.for(API_SYMBOL);
const LOG_PREFIX = "[moonOreAnomalies]";

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

// Resolution still uses Node's parent-aware resolver on every call. Only
// successful filesystem identities are memoized; failed probes remain retryable.
// Do not reject by basename: symlinks/packages can alias an exact owned target.
function createCanonicalCache(canonicalize, options = {}) {
  const identities = new Map();
  return function canonicalizeResolved(filename) {
    if (identities.has(filename)) return identities.get(filename);
    let succeeded = false;
    const canonical = canonicalize(filename, {
      ...options,
      realpath(value) {
        const result = (options.realpath || fs.realpathSync.native || fs.realpathSync)(value);
        succeeded = true;
        return result;
      },
    });
    // canonicalize preserves its existing lexical fallback on realpath failure,
    // but that fallback must not prevent a later successful canonicalization.
    if (succeeded) identities.set(filename, canonical);
    return canonical;
  };
}

function install(options = {}) {
  if (!isMainThread && options.allowWorker !== true) return Object.freeze({ active: false, reason: "worker-thread" });
  if (globalThis[INSTALL_MARKER]) return globalThis[INSTALL_MARKER];
  if (globalThis[API_MARKER]) throw new Error("MOON_API_MARKER_ALREADY_PRESENT");

  const runtimeRoot = path.resolve(options.runtimeRoot || path.join(MOD_DIR, "../.."));
  const config = options.config || configModule.load(MOD_DIR, options.environment || process.env);
  const loadedRules = options.rules
    ? { ok: true, rules: options.rules }
    : moonRules.load(MOD_DIR);
  if (!loadedRules.ok) throw new Error(`MOON_RULES_INVALID:${loadedRules.problems.join(";")}`);
  const rules = loadedRules.rules;
  const viable = viability.run(runtimeRoot, {
    enabled: config.enabled,
    environment: options.environment || process.env,
    rules,
    systemIDs: options.systemIDs,
  });
  const api = createRuntimeApi({ enabled: config.enabled, rules, version: MOD_VERSION,
    settings: config,
    templateIDs: Object.fromEntries(Object.entries(snapshots.templatesByFamily)
      .map(([family, row]) => [family, row.templateID])),
  });
  const canonicalTargets = new Map(
    Object.entries(viable.targets).map(([name, target]) => [target.canonical, { name, target }]),
  );
  const canonicalizeResolved = createCanonicalCache(viability.canonicalize);
  const previousLoad = Module._load;
  const restorers = [];
  const transformedFiles = new Set();
  const installedTargets = new Set();
  let rollingBack = false;
  let state = null;

  function rollback(cause = null) {
    if (rollingBack) return;
    rollingBack = true;
    if (Module._load === hookedLoad) Module._load = previousLoad;
    for (const restore of restorers.reverse()) {
      try { restore(); } catch (_) { /* startup is already failing closed */ }
    }
    for (const target of Object.values(viable.targets)) delete Module._cache[target.filename];
    if (globalThis[API_MARKER] === api) delete globalThis[API_MARKER];
    if (globalThis[INSTALL_MARKER] === state) delete globalThis[INSTALL_MARKER];
    if (state) {
      state.active = false;
      state.failure = cause ? String(cause.message || cause) : null;
    }
  }

  function installExportOverlay(name, result) {
    if (installedTargets.has(name)) return result;
    if (name === "contentPackManager") {
      const installation = contentOverlay.install(result, {
        rules,
        snapshots,
        modVersion: MOD_VERSION,
        contentRevision: TEMPLATE_CONTENT_REVISION,
        onFailure: rollback,
      });
      restorers.push(installation.restore);
    } else if (name === "dungeonRuntime") {
      const installation = lifecycleRetirement.installUpgradeRetention(result, {
        enabled: config.enabled,
        rules,
        templateIDs: Object.fromEntries(
          Object.entries(snapshots.templatesByFamily).map(([family, row]) => [family, row.templateID]),
        ),
      });
      restorers.push(installation.restore);
      if (config.enabled) {
        const presentation = presentationOverlay.install(result, snapshots);
        restorers.push(presentation.restore);
      }
    } else if (name === "explorationAuthority") {
      const original = result.getScanStrengthAttribute;
      const report = scanStrengthOverlay.install(result, rules, config.verbose ? log : null);
      if (!report.ok) throw new Error(`MOON_SCAN_OVERLAY_FAILED:${report.problems.join(";")}`);
      restorers.push(() => { result.getScanStrengthAttribute = original; });
    } else if (name === "globalSiteSchedulerRuntime") {
      const installation = lifecycleRetirement.install(result, {
        api,
        enabled: config.enabled,
        log,
        modVersion: MOD_VERSION,
        onFailure: rollback,
        rules,
        runtimeRoot,
        templateIDs: Object.fromEntries(
          Object.entries(snapshots.templatesByFamily).map(([family, row]) => [family, row.templateID]),
        ),
      });
      restorers.push(installation.restore);
    }
    installedTargets.add(name);
    return result;
  }

  function hookedLoad(request, parent, isMain) {
    if (Module.isBuiltin(request)) return previousLoad.apply(this, arguments);
    let resolved;
    try {
      resolved = Module._resolveFilename(request, parent, isMain);
    } catch (_) {
      return previousLoad.apply(this, arguments);
    }
    const match = typeof resolved === "string"
      ? canonicalTargets.get(canonicalizeResolved(resolved))
      : null;
    if (!match) return previousLoad.apply(this, arguments);

    try {
      const { name, target } = match;
      if (target.kind === "transform") {
        if (transformedFiles.has(target.filename)) {
          const cached = Module._cache[target.filename];
          if (!cached) throw new Error(`MOON_TRANSFORM_RECURSION_CACHE_MISSING:${target.filename}`);
          return cached.exports;
        }
        if (Module._cache[target.filename]) throw new Error(`MOON_TRANSFORM_TARGET_CACHED:${target.filename}`);
        transformedFiles.add(target.filename);
        // Re-read at compile time so the transform always receives the current
        // incoming file. Its semantic seam checks decide whether composition is safe.
        return sourceTransforms.loadTransformed(target.filename, parent, rules.siteIDBases, null, name);
      }
      const exported = previousLoad.apply(this, arguments);
      return target.kind === "overlay" ? installExportOverlay(name, exported) : exported;
    } catch (error) {
      rollback(error);
      throw error;
    }
  }

  globalThis[API_MARKER] = api;
  Module._load = hookedLoad;
  state = {
    active: true,
    api,
    config,
    enabled: config.enabled,
    failure: null,
    hookedLoad,
    installedTargets,
    previousLoad,
    rollback,
    runtimeRoot,
    siteIDReport: viable.siteIDReport,
    targets: viable.targets,
    version: MOD_VERSION,
    minedOutLifecycleAvailable: Boolean(viable.targets.dungeonUniverseSiteService),
  };
  globalThis[INSTALL_MARKER] = state;
  if (config.enabled && options.transientNames !== false) {
    try {
      state.transientNames = require("./lib/transientNames").install(runtimeRoot, MOD_DIR);
      if (state.transientNames.active) restorers.push(() => state.transientNames.restore());
      else console.warn("[moonOreAnomalies/names] UNAVAILABLE: " + state.transientNames.reason);
    } catch (error) { state.transientNames = { active: false, reason: error.message }; }
  }
  if (config.enabled) {
    if (!state.minedOutLifecycleAvailable) {
      log("native mined-out handler unavailable on legacy 0.12.8; automatic depletion completion requires 0.12.9 or a reviewed date-based release");
    }
    log(
      `v${MOD_VERSION} armed for ${Object.keys(rules.families).length} families; ` +
      `${viable.siteIDReport.checkedMoonSiteIDs} site IDs collision-checked across ` +
      `${viable.siteIDReport.solarSystemCount} systems`,
    );
  } else {
    log(`v${MOD_VERSION} retirement-only mode armed; keep the loader enabled until retirement success is logged`);
  }
  return state;
}

let installation = null;
if (process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL !== "1") {
  installation = install();
}

module.exports = {
  API_MARKER,
  INSTALL_MARKER,
  MOD_DIR,
  MOD_VERSION,
  TEMPLATE_CONTENT_REVISION,
  install,
  installation,
};
