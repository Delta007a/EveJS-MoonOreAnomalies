"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const sourceTransforms = require("./sourceTransforms");

// These are hook targets, not whole-file ownership claims.  Runtime overlays
// validate the exact exports they wrap when those modules load; the sole source
// transform validates its three owned seams against the current incoming text.
const TARGETS = Object.freeze({
  contentPackManager: Object.freeze({ relative: "server/src/contentPacks/contentPackManager.js", kind: "overlay" }),
  dungeonUniverseRuntime: Object.freeze({ relative: sourceTransforms.TARGET, kind: "transform" }),
  explorationAuthority: Object.freeze({ relative: "server/src/services/exploration/explorationAuthority.js", kind: "overlay" }),
  globalSiteSchedulerRuntime: Object.freeze({ relative: "server/src/services/dungeon/globalSiteSchedulerRuntime.js", kind: "overlay" }),
  dungeonRuntime: Object.freeze({ relative: "server/src/services/dungeon/dungeonRuntime.js", kind: "overlay" }),
});

function canonicalize(filename, options = {}) {
  const platform = options.platform || process.platform;
  const resolved = path.resolve(String(filename || ""));
  const realpath = options.realpath || (fs.realpathSync.native || fs.realpathSync);
  let canonical;
  try { canonical = realpath(resolved); } catch (_) { canonical = resolved; }
  canonical = canonical.split(path.sep).join("/");
  return platform === "win32" ? canonical.toLowerCase() : canonical;
}

function resolveDataDir(runtimeRoot, environment = process.env) {
  if (environment.EVEJS_GAMESTORE_DATA_DIR) return path.resolve(environment.EVEJS_GAMESTORE_DATA_DIR);
  const local = path.join(runtimeRoot, "_local", "gameStore", "data");
  if (fs.existsSync(local)) return local;
  return path.join(runtimeRoot, "server", "src", "gameStore", "data");
}

function readSolarSystemIDs(runtimeRoot, options = {}) {
  if (Array.isArray(options.systemIDs)) return [...options.systemIDs];
  const file = path.join(resolveDataDir(runtimeRoot, options.environment), "solarSystems", "data.json");
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(payload.solarSystems) ? payload.solarSystems : [];
  return rows.map((row) => Number(row && (row.solarSystemID ?? row.systemID)));
}

function parseVendorBases(source) {
  const anchorStart = source.indexOf(sourceTransforms.ID_ANCHOR);
  const anchorEnd = anchorStart >= 0 ? source.indexOf("});", anchorStart) : -1;
  if (anchorStart < 0 || anchorEnd < 0) throw new Error("MOON_SITE_ID_TABLE_NOT_FOUND");
  let block = source.slice(anchorStart + sourceTransforms.ID_ANCHOR.length, anchorEnd).replace(/\r\n/g, "\n");
  const result = {};
  const spreadStart = block.indexOf("  ...Object.fromEntries([");
  if (spreadStart >= 0) {
    const end = block.indexOf("\n  combat:", spreadStart);
    if (end < 0) throw new Error("MOON_VENDOR_COMPUTED_TABLE_CHANGED");
    const spread = block.slice(spreadStart, end);
    if (require("node:crypto").createHash("sha256").update(spread).digest("hex") !== "8b49eb15bc9f1578e404eb428b668b74c24d82553a3ae9f5a280014fcc4797b3") throw new Error("MOON_VENDOR_COMPUTED_TABLE_CHANGED");
    const families = [...spread.matchAll(/"(homefront_[a-z_]+)"/g)].map(match => match[1]);
    if (families.length !== 24) throw new Error("MOON_VENDOR_COMPUTED_TABLE_CHANGED");
    families.forEach((family, index) => { result[family] = 7_000_000_000_000 + index * 50_000_000_000; });
    block = block.slice(0, spreadStart) + block.slice(end);
  }
  block = block.replace(/\/\/[^\n]*/g, "");
  block = block.replace(/^\s*([a-z][a-z0-9_]*)\s*:\s*([0-9_]+)\s*,/gm, (_, family, value) => {
    if (Object.hasOwn(result, family)) throw new Error("MOON_VENDOR_DUPLICATE_FAMILY");
    result[family] = Number(value.replaceAll("_", ""));
    return "";
  });
  if (block.trim()) throw new Error("MOON_VENDOR_ID_TABLE_SYNTAX_CHANGED");
  if (Object.keys(result).length === 0) throw new Error("MOON_SITE_ID_TABLE_EMPTY");
  return result;
}

function validateSiteIDNamespaces(source, siteIDBases, rawSystemIDs) {
  const systemIDs = [...new Set(rawSystemIDs.map(Number))].sort((a, b) => a - b);
  if (systemIDs.length === 0 || systemIDs.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("MOON_SOLAR_SYSTEM_CATALOG_INVALID");
  }
  const systemSet = new Set(systemIDs);
  const vendorBases = parseVendorBases(source);
  const allBases = { ...vendorBases, ...siteIDBases };
  for (const family of Object.keys(siteIDBases)) {
    if (Object.prototype.hasOwnProperty.call(vendorBases, family)) throw new Error(`MOON_SITE_ID_FAMILY_CONFLICT:${family}`);
  }
  const seenMoonSiteIDs = new Map();
  for (const [family, rawBase] of Object.entries(siteIDBases)) {
    const base = Number(rawBase);
    if (!Number.isSafeInteger(base) || base <= 0 || base % 1000 !== 0) throw new Error(`MOON_SITE_ID_BASE_INVALID:${family}`);
    for (const systemID of systemIDs) {
      const siteID = base + (systemID * 1000) + 1;
      const maximumRockID = 6_600_000_000_000 + (siteID * 1000) + 16;
      if (!Number.isSafeInteger(siteID) || !Number.isSafeInteger(maximumRockID)) throw new Error(`MOON_SITE_ID_UNSAFE_INTEGER:${family}:${systemID}`);
      if (seenMoonSiteIDs.has(siteID)) throw new Error(`MOON_SITE_ID_COLLISION:${family}:${seenMoonSiteIDs.get(siteID)}`);
      seenMoonSiteIDs.set(siteID, `${family}:${systemID}`);
      for (const [otherFamily, otherBase] of Object.entries(allBases)) {
        if (otherFamily === family) continue;
        const raw = siteID - Number(otherBase) - 1;
        const otherSystemID = Math.floor(raw / 1000);
        const otherSlotIndex = raw - (otherSystemID * 1000);
        if (otherSlotIndex >= 0 && otherSlotIndex < 1000 && systemSet.has(otherSystemID)) {
          throw new Error(`MOON_SITE_ID_COLLISION:${family}:${systemID}:${otherFamily}:${otherSystemID}:${otherSlotIndex}`);
        }
      }
    }
  }
  return Object.freeze({
    solarSystemCount: systemIDs.length,
    minimumSolarSystemID: systemIDs[0],
    maximumSolarSystemID: systemIDs[systemIDs.length - 1],
    checkedMoonSiteIDs: seenMoonSiteIDs.size,
    vendorFamilyCount: Object.keys(vendorBases).length,
  });
}

function run(runtimeRoot, options = {}) {
  const enabled = options.enabled === true;
  const specs = enabled
    ? TARGETS
    : { globalSiteSchedulerRuntime: TARGETS.globalSiteSchedulerRuntime, dungeonRuntime: TARGETS.dungeonRuntime };
  const targets = {};
  for (const [name, spec] of Object.entries(specs)) {
    const filename = path.resolve(runtimeRoot, spec.relative);
    if (!fs.existsSync(filename)) throw new Error(`MOON_TARGET_MISSING:${spec.relative}`);
    const source = fs.readFileSync(filename, "utf8");
    targets[name] = Object.freeze({ ...spec, filename, canonical: canonicalize(filename), source });
  }
  const cached = new Set(Object.keys(Module._cache).map((filename) => canonicalize(filename)));
  for (const target of Object.values(targets)) {
    if (cached.has(target.canonical)) throw new Error(`MOON_TARGET_PRE_CACHED:${target.filename}`);
  }
  let siteIDReport = null;
  if (enabled) {
    const inspect = sourceTransforms.inspectUniverseRuntime(
      targets.dungeonUniverseRuntime.source,
      options.rules.siteIDBases,
    );
    if (!inspect.ok) throw new Error(`MOON_TRANSFORM_NOT_VIABLE:${inspect.reason}`);
    siteIDReport = validateSiteIDNamespaces(
      targets.dungeonUniverseRuntime.source,
      options.rules.siteIDBases,
      readSolarSystemIDs(runtimeRoot, options),
    );
  }
  return Object.freeze({ targets: Object.freeze(targets), siteIDReport });
}

module.exports = {
  // PREIMAGES remains as a compatibility alias for older Moon tooling.  The
  // entries intentionally contain no hashes and are never used as preimages.
  PREIMAGES: TARGETS,
  TARGETS,
  canonicalize,
  parseVendorBases,
  readSolarSystemIDs,
  resolveDataDir,
  run,
  validateSiteIDNamespaces,
};
