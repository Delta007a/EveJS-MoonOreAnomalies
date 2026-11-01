"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const modDir = path.resolve(__dirname, "..");
const runtimeRoot = path.resolve(modDir, "../..");
const cleanRoot = path.resolve(
  process.argv[2] || path.join(runtimeRoot, "../EveJS-0.12.9"),
);
const results = [];
const failures = [];
const asyncChecks = [];

function test(name, operation) {
  try {
    operation();
    results.push(name);
    console.log(`PASS ${String(results.length).padStart(3, "0")} ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.stack || error}`);
  }
}

function testAsync(name, operation) {
  asyncChecks.push({ name, operation });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadSourceModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, "utf8");
  return compileSourceModule(filename, source, mocks);
}

function compileSourceModule(filename, source, mocks = {}) {
  const moduleRecord = { exports: {} };
  const localRequire = (request) => {
    if (Module.builtinModules.includes(request) || request.startsWith("node:")) return require(request);
    const normalized = String(request).replaceAll("\\", "/");
    const key = Object.keys(mocks).find((suffix) => normalized.endsWith(suffix));
    if (key) return mocks[key];
    throw new Error(`Unexpected vendor dependency ${request} while loading ${filename}`);
  };
  const wrapper = new vm.Script(Module.wrap(source), { filename }).runInThisContext();
  wrapper(moduleRecord.exports, localRequire, moduleRecord, filename, path.dirname(filename));
  return moduleRecord.exports;
}

const configModule = require("../config");
const contentOverlay = require("../lib/contentOverlay");
const lifecycle = require("../lib/lifecycleRetirement");
const moonRules = require("../lib/moonRules");
const presentationOverlay = require("../lib/presentationOverlay");
const runtimeApiModule = require("../lib/runtimeApi");
const scanOverlay = require("../lib/scanStrengthOverlay");
const transforms = require("../lib/sourceTransforms");
const viability = require("../lib/viability");
const snapshots = require("../data/moonOreTemplates.v1.json");
const loadedRules = moonRules.load(modDir);
assert.strictEqual(loadedRules.ok, true, loadedRules.problems && loadedRules.problems.join(";"));
const rules = loadedRules.rules;
const families = Object.keys(rules.families);
const expectedMoonNames = {
  moon_r4: "R4 Moon Ore Field",
  moon_r8: "R8 Moon Ore Field",
  moon_r16: "R16 Moon Ore Field",
  moon_r32: "R32 Moon Ore Field",
  moon_r64: "R64 Moon Ore Field",
};
const api = runtimeApiModule.createRuntimeApi({ enabled: true, rules, version: "0.2.0" });
globalThis[Symbol.for(runtimeApiModule.API_SYMBOL)] = api;

const contentManager = require(path.join(cleanRoot, "server/src/contentPacks/contentPackManager"));
const baseAuthority = require(path.join(cleanRoot, "tools/DatabaseCreator/staticTables/dungeonAuthority/data.json"));
const officialPack = contentManager.readContentPackFile(
  path.join(cleanRoot, "content-packs/evejs-ore-anomalies-1.1.0.json"),
);
const officialAuthority = contentManager.applyDungeonContentPacks(baseAuthority, [officialPack]);
const effectivePayload = contentOverlay.apply(officialAuthority, rules, snapshots, {
  modVersion: "0.3.0",
  contentRevision: "0.2.0",
  rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields,
});
const historicalNameSnapshots = clone(snapshots);
Object.assign(historicalNameSnapshots.templatesByFamily.moon_r4, { resolvedName: "Large Potent Asteroid Cluster" });
Object.assign(historicalNameSnapshots.templatesByFamily.moon_r8, { resolvedName: "Enormous Potent Asteroid Cluster" });
Object.assign(historicalNameSnapshots.templatesByFamily.moon_r16, { resolvedName: "Colossal Potent Asteroid Cluster" });
Object.assign(historicalNameSnapshots.templatesByFamily.moon_r32, { resolvedName: "Enormous Rich Asteroid Cluster" });
Object.assign(historicalNameSnapshots.templatesByFamily.moon_r64, { resolvedName: "Colossal Rich Asteroid Cluster" });
const historicalNamePayload = contentOverlay.apply(officialAuthority, rules, historicalNameSnapshots, {
  modVersion: "0.3.0",
  contentRevision: "0.2.0",
  rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields,
});

function authorityFacade(payload = effectivePayload) {
  const templates = Object.values(payload.templatesByID || {});
  const profiles = payload.spawnProfiles && payload.spawnProfiles.families || {};
  return {
    getSpawnProfile: (family) => clone(profiles[String(family || "").toLowerCase()] || null),
    getTemplateByID: (templateID) => clone(payload.templatesByID[templateID] || null),
    getTemplateSelectionDescriptorByID: (templateID) => payload.templatesByID[templateID] || null,
    listTemplatesByFamily: (family) => clone(templates.filter((row) => row.siteFamily === family)),
    listTemplateSelectionDescriptorsByFamily: (family) => templates.filter((row) => row.siteFamily === family),
    listUniverseSpawnFamilies: () => Object.keys(profiles),
  };
}

test("rules retain exactly five Moon families", () => assert.deepStrictEqual(families, ["moon_r4", "moon_r8", "moon_r16", "moon_r32", "moon_r64"]));
test("all families retain 1440-minute lifetime", () => assert.ok(families.every((family) => rules.families[family].siteLifetimeMinutes === 1440)));
test("each family declares four ore rows and sixteen rocks", () => assert.ok(families.every((family) => rules.families[family].miningRocks.length === 4 && rules.families[family].miningRocks.reduce((sum, row) => sum + row.count, 0) === 16)));
test("all twenty Moon ore type IDs are unique", () => assert.strictEqual(new Set(families.flatMap((family) => rules.families[family].miningRocks.map((row) => row.typeID))).size, 20));
test("accepted quantities are unchanged", () => assert.deepStrictEqual(families.map((family) => [...new Set(rules.families[family].miningRocks.map((row) => row.quantity))][0]), [4000, 3500, 3000, 2500, 2000]));
test("R4 and R8 retain high low null bands", () => assert.ok(["moon_r4", "moon_r8"].every((family) => rules.families[family].securityBands.join() === "highsec,lowsec,nullsec")));
test("R16 R32 R64 remain excluded from highsec", () => assert.ok(["moon_r16", "moon_r32", "moon_r64"].every((family) => rules.families[family].securityBands.join() === "lowsec,nullsec")));
test("Pochven override remains zero", () => assert.deepStrictEqual(rules.regionOverrides["10000070"], { slots: 0, p: 0 }));
test("config defaults disabled", () => assert.strictEqual(configModule.load(path.join(os.tmpdir(), "missing-moon-ore-config"), {}).enabled, false));
test("deployed mod-local environment enables the mod", () => assert.strictEqual(configModule.load(modDir, {}).enabled, true));
test("real environment overrides mod-local env", () => assert.strictEqual(configModule.load(modDir, { EVEJS_MOON_ORE_ANOMALIES: "0" }).enabled, false));
test("boolean parser retains accepted spellings", () => assert.ok(["1", "true", "yes", "on", "enabled"].every((value) => configModule.readBoolean(value) === true) && ["0", "false", "no", "off", "disabled"].every((value) => configModule.readBoolean(value, true) === false)));

test("content overlay adds five self-contained templates", () => assert.strictEqual(Object.values(effectivePayload.templatesByID).filter((row) => row && row._moonOreAnomalies).length, 5));
test("content overlay adds five spawn profiles", () => assert.strictEqual(families.filter((family) => effectivePayload.spawnProfiles.families[family]).length, 5));
test("template identities are stable and mod-owned", () => assert.ok(families.every((family) => effectivePayload.templatesByID[snapshots.templatesByFamily[family].templateID].templateID.startsWith("evejs-mod:moon-ore:"))));
test("all five Moon families resolve to exact Moon-specific names", () => assert.deepStrictEqual(Object.fromEntries(families.map((family) => [family, effectivePayload.templatesByID[snapshots.templatesByFamily[family].templateID].resolvedName])), expectedMoonNames));
test("Moon templates are source-less", () => assert.ok(families.every((family) => !Object.prototype.hasOwnProperty.call(effectivePayload.templatesByID[snapshots.templatesByFamily[family].templateID], "sourceDungeonID"))));
test("Moon templates do not emit historical donor localization IDs", () => assert.ok(families.every((family) => effectivePayload.templatesByID[snapshots.templatesByFamily[family].templateID].dungeonNameID === null)));
test("historical donor IDs remain non-authoritative provenance", () => assert.deepStrictEqual(families.map((family) => snapshots.templatesByFamily[family].historicalSourceDungeonID), [5524, 5525, 5526, 5528, 5529]));
test("exact reviewed official ore pack is accepted", () => assert.strictEqual(contentOverlay.validateOfficialOrePack(effectivePayload).present, true));
test("official ore pack absence is accepted", () => assert.strictEqual(contentOverlay.validateOfficialOrePack(baseAuthority).present, false));
test("templates carry exactly sixteen materializable rocks", () => assert.ok(families.every((family) => effectivePayload.templatesByID[snapshots.templatesByFamily[family].templateID].populationHints.miningRocks.reduce((sum, row) => sum + row.count, 0) === 16)));
test("templates index all twenty resource IDs", () => assert.ok(families.flatMap((family) => rules.families[family].miningRocks).every((rock) => effectivePayload.indexes.templateIDsBySource && Object.values(effectivePayload.templatesByID).some((template) => (template.resourceComposition.oreTypeIDs || []).includes(rock.typeID)))));
test("family indexes expose one Moon template apiece", () => assert.ok(families.every((family) => effectivePayload.indexes.templateIDsByFamily[family].length === 1)));
test("sourceDungeon indexes map historical IDs only to official templates", () => assert.ok(families.every((family) => effectivePayload.indexes.templateIDsBySourceDungeonID[String(snapshots.templatesByFamily[family].historicalSourceDungeonID)] === `client-dungeon:${snapshots.templatesByFamily[family].historicalSourceDungeonID}`)));
test("Moon templates are absent from the sourceDungeon index", () => assert.ok(families.every((family) => !Object.values(effectivePayload.indexes.templateIDsBySourceDungeonID).includes(snapshots.templatesByFamily[family].templateID))));
test("profiles preserve accepted lifetime", () => assert.ok(families.every((family) => effectivePayload.spawnProfiles.families[family].siteLifetimeMinutes === 1440)));
test("profiles exclude Pochven", () => assert.ok(families.every((family) => effectivePayload.spawnProfiles.families[family].excludeRegionIDs.includes(10000070))));
test("profiles do not claim ordinary ore selection authority", () => assert.ok(families.every((family) => !effectivePayload.spawnProfiles.families[family].selectionAuthority)));
test("all six historical official templates remain byte-equivalent", () => {
  for (const sourceDungeonID of [5524, 5525, 5526, 5527, 5528, 5529]) {
    const templateID = `client-dungeon:${sourceDungeonID}`;
    assert.deepStrictEqual(effectivePayload.templatesByID[templateID], officialAuthority.templatesByID[templateID]);
  }
});
test("presentation overlay relabels active Moon reads without mutating persisted content", () => {
  const templateID = snapshots.templatesByFamily.moon_r4.templateID;
  const stored = { templateID, siteFamily: "moon_r4", dungeonNameID: 289412, metadata: { label: "Large Potent Asteroid Cluster", definitionHash: "unchanged" }, spawnState: { label: "Large Potent Asteroid Cluster", populationHints: { miningRocks: [{ typeID: 16633, quantity: 4000 }] } } };
  const listeners = new Set();
  const runtime = {
    getInstance: () => stored,
    listActiveInstancesBySystem: () => [stored],
    registerInstanceChangeListener: (listener) => listeners.add(listener),
    unregisterInstanceChangeListener: (listener) => listeners.delete(listener),
  };
  const installation = presentationOverlay.install(runtime, snapshots);
  try {
    const presented = runtime.getInstance(1);
    assert.strictEqual(presented.metadata.label, "R4 Moon Ore Field");
    assert.strictEqual(presented.spawnState.label, "R4 Moon Ore Field");
    assert.strictEqual(presented.dungeonNameID, null);
    assert.strictEqual(presented.metadata.definitionHash, "unchanged");
    assert.deepStrictEqual(presented.spawnState.populationHints, stored.spawnState.populationHints);
    assert.strictEqual(stored.metadata.label, "Large Potent Asteroid Cluster");
    assert.strictEqual(stored.dungeonNameID, 289412);
    let received = null;
    const listener = (change) => { received = change; };
    runtime.registerInstanceChangeListener(listener);
    [...listeners][0]({ before: stored, after: stored });
    assert.strictEqual(received.after.metadata.label, "R4 Moon Ore Field");
    assert.strictEqual(received.after.dungeonNameID, null);
    runtime.unregisterInstanceChangeListener(listener);
    assert.strictEqual(listeners.size, 0);
  } finally {
    installation.restore();
  }
});
test("ordinary non-Moon templates remain byte-equivalent", () => { const id = Object.keys(officialAuthority.templatesByID).find((key) => officialAuthority.templatesByID[key].siteFamily !== "ore"); assert.deepStrictEqual(effectivePayload.templatesByID[id], officialAuthority.templatesByID[id]); });
test("template ID conflict fails closed", () => { const payload = clone(officialAuthority); payload.templatesByID[snapshots.templatesByFamily.moon_r4.templateID] = { siteFamily: "other" }; assert.throws(() => contentOverlay.apply(payload, rules, snapshots, { modVersion: "x", contentRevision: "0.2.0", rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields }), /MOON_TEMPLATE_ID_CONFLICT/); });
test("historical source ownership does not conflict", () => { const payload = clone(baseAuthority); payload.templatesByID.foreign = { siteFamily: "foreign", sourceDungeonID: 5524 }; assert.doesNotThrow(() => contentOverlay.apply(payload, rules, snapshots, { modVersion: "x", contentRevision: "0.2.0", rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields })); });
test("spawn profile conflict fails closed", () => { const payload = clone(baseAuthority); payload.spawnProfiles.families.moon_r4 = {}; assert.throws(() => contentOverlay.apply(payload, rules, snapshots, { modVersion: "x", rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields }), /MOON_SPAWN_PROFILE_CONFLICT/); });
test("changed official ore pack identity fails closed", () => { const payload = clone(officialAuthority); payload.meta.installedContentPacks[0].packSha256 = "0".repeat(64); assert.throws(() => contentOverlay.apply(payload, rules, snapshots, { modVersion: "x", contentRevision: "0.2.0", rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields }), /MOON_OFFICIAL_ORE_PACK_MISMATCH/); });
test("duplicated official ore pack identity fails closed", () => { const payload = clone(officialAuthority); payload.meta.installedContentPacks.push(clone(payload.meta.installedContentPacks[0])); assert.throws(() => contentOverlay.apply(payload, rules, snapshots, { modVersion: "x", contentRevision: "0.2.0", rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields }), /MOON_OFFICIAL_ORE_PACK_MISMATCH/); });
test("pre-cache content-manager overlay feeds authority-ready payload", () => {
  const manager = {
    rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields,
    applyDungeonContentPacks: (payload) => clone(payload),
  };
  const installation = contentOverlay.install(manager, { rules, snapshots, modVersion: "test", contentRevision: "0.2.0" });
  try {
    const payload = manager.applyDungeonContentPacks(baseAuthority, []);
    assert.ok(families.every((family) => payload.indexes.templateIDsByFamily[family].length === 1));
  } finally {
    installation.restore();
  }
});

function acceptedRoll(systemID, family, band, slotIndex = 0) {
  const p = Number(rules.families[family].density[band].p);
  const salt = runtimeApiModule.hashText(`density:${family}`);
  const roll = runtimeApiModule.hashValue(runtimeApiModule.hashValue((systemID * 4099) + (slotIndex * 131)) + salt);
  return (roll / 0x1_0000_0000) < p;
}
test("Moon probability adapter matches accepted 0.12.6 hash formula", () => families.forEach((family) => rules.families[family].securityBands.forEach((band) => [30000001, 30000123, 30000999].forEach((id) => assert.strictEqual(api.slotSpawnsInSystem(id, family, band, 0), acceptedRoll(id, family, band, 0))))));
test("probability decisions are deterministic", () => assert.strictEqual(api.slotSpawnsInSystem(30001234, "moon_r4", "highsec", 0), api.slotSpawnsInSystem(30001234, "moon_r4", "highsec", 0)));
test("unknown Moon families never inherit a default", () => assert.strictEqual(api.slotSpawnsInSystem(30000001, "moon_unknown", "highsec", 0), false));
test("slot ceiling remains one", () => assert.ok(families.every((family) => api.getSlotCeiling(family) === 1)));

const universeFile = path.join(cleanRoot, transforms.TARGET);
const universeSource = fs.readFileSync(universeFile, "utf8");
const transformedUniverseSource = transforms.transformUniverseRuntime(universeSource, rules.siteIDBases);
test("universe transform adds its marker", () => assert.ok(transformedUniverseSource.includes(transforms.MARKER)));
test("universe transform injects all five namespaces", () => assert.ok(families.every((family) => transformedUniverseSource.includes(`${family}: ${rules.siteIDBases[family]}`))));
test("universe transform contains Moon-only probability call", () => assert.ok(transformedUniverseSource.includes("slotSpawnsInSystem(numericSystemID, entry.family, band, 0, () => dungeonRuntime.listInstancesBySystem")));
test("universe transform blocks unknown moon_ count fallback", () => assert.ok(transformedUniverseSource.includes('if (normalizedFamily.startsWith("moon_"))')));
test("transformed universe source parses", () => assert.doesNotThrow(() => new Function("require", "module", "exports", "__filename", "__dirname", transformedUniverseSource)));
test("transform refuses duplicate application", () => assert.throws(() => transforms.transformUniverseRuntime(transformedUniverseSource, rules.siteIDBases), /MOON_TRANSFORM_ALREADY_APPLIED/));
test("transform refuses a missing anchor", () => assert.throws(() => transforms.transformUniverseRuntime(universeSource.replace(transforms.COUNT_ANCHOR.replaceAll("\n", "\r\n"), ""), rules.siteIDBases), /anchor count 0/));

for (const [name, spec] of Object.entries(viability.TARGETS)) {
  test(`vendor ${name} informational hash matches clean final 0.12.9`, () => {
    assert.strictEqual(
      hashFile(path.join(runtimeRoot, spec.relative)),
      hashFile(path.join(cleanRoot, spec.relative)),
    );
  });
}
test("Windows canonicalization folds case", () => assert.strictEqual(viability.canonicalize(runtimeRoot.toUpperCase(), { platform: "win32", realpath: (value) => value }), viability.canonicalize(runtimeRoot.toLowerCase(), { platform: "win32", realpath: (value) => value })));
test("Linux canonicalization preserves case", () => assert.notStrictEqual(viability.canonicalize("/Tmp/Moon", { platform: "linux", realpath: (value) => value }), viability.canonicalize("/tmp/moon", { platform: "linux", realpath: (value) => value })));
test("site-ID validation covers every family and supplied system", () => assert.strictEqual(viability.validateSiteIDNamespaces(universeSource, rules.siteIDBases, [30000001, 30000002, 31000001, 32000001]).checkedMoonSiteIDs, 20));
test("logical site IDs and site keys are unique across families", () => {
  const systemIDs = [30000001, 30000002, 31000001, 32000001];
  const siteIDs = families.flatMap((family) => systemIDs.map((systemID) => rules.siteIDBases[family] + systemID * 1000 + 1));
  const siteKeys = families.flatMap((family) => systemIDs.map((systemID) => `sceneAnomalySite:${systemID}:${rules.siteIDBases[family] + systemID * 1000 + 1}:${snapshots.templatesByFamily[family].templateID}`));
  assert.strictEqual(new Set(siteIDs).size, siteIDs.length);
  assert.strictEqual(new Set(siteKeys).size, siteKeys.length);
  assert.ok(siteIDs.every((siteID) => siteID > 0 && Number.isSafeInteger(siteID)));
});
test("site-ID validation detects current namespace collision", () => assert.throws(() => viability.validateSiteIDNamespaces(universeSource, { moon_r4: 5_900_000_000_000 }, [30000001]), /MOON_SITE_ID_COLLISION/));
test("site-ID validation rejects unsafe entity IDs", () => assert.throws(() => viability.validateSiteIDNamespaces(universeSource, { moon_r4: 9_000_000_000_000 }, [32000001]), /UNSAFE_INTEGER/));
test("transactional viability passes with injected isolated system catalog", () => assert.strictEqual(viability.run(runtimeRoot, { enabled: true, rules, systemIDs: [30000001, 30000002, 31000001] }).siteIDReport.checkedMoonSiteIDs, 15));
test("transactional viability rejects an owned source-seam mismatch", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moon-ore-source-mismatch-"));
  try {
    for (const spec of Object.values(viability.PREIMAGES)) {
      const source = path.join(runtimeRoot, spec.relative);
      const destination = path.join(temporaryRoot, spec.relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    const universeFixture = path.join(
      temporaryRoot,
      viability.TARGETS.dungeonUniverseRuntime.relative,
    );
    const fixtureSource = fs.readFileSync(universeFixture, "utf8");
    const countAnchor = transforms.anchorVariants(transforms.COUNT_ANCHOR)
      .find((candidate) => fixtureSource.includes(candidate));
    assert.ok(countAnchor, "owned count anchor must exist in mismatch fixture");
    fs.writeFileSync(
      universeFixture,
      fixtureSource.replace(
        countAnchor,
        countAnchor.replace("countsByFamily", "countsForFamilies"),
      ),
      "utf8",
    );
    assert.throws(
      () => viability.run(temporaryRoot, { enabled: true, rules, systemIDs: [30000001] }),
      /MOON_TRANSFORM_NOT_VIABLE:moon fixed-count guard: anchor count 0/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
test("transactional viability rejects a pre-cached target", () => { const filename = path.join(runtimeRoot, viability.PREIMAGES.contentPackManager.relative); const old = Module._cache[filename]; Module._cache[filename] = { exports: {} }; try { assert.throws(() => viability.run(runtimeRoot, { enabled: true, rules, systemIDs: [30000001] }), /MOON_TARGET_PRE_CACHED/); } finally { if (old) Module._cache[filename] = old; else delete Module._cache[filename]; } });
test("all semantic-hook vendor files are byte-identical to clean final 0.12.9", () => Object.values(viability.TARGETS).forEach((spec) => assert.ok(fs.readFileSync(path.join(runtimeRoot, spec.relative)).equals(fs.readFileSync(path.join(cleanRoot, spec.relative))), spec.relative)));

function createUniverseHarness(dungeonRuntime = null, authorityPayload = effectivePayload) {
  const systemRecords = new Map();
  const authority = authorityFacade(authorityPayload);
  const normalizePolicyContext = (value = {}) => ({
    securityBand: value.securityBand || "nullsec",
    localPirateFactionKey: value.localPirateFactionKey || "mixed",
    localPirateFactionSource: value.localPirateFactionSource || "test",
    localPirateFactionSpecialSpace: value.localPirateFactionSpecialSpace === true,
    sovereignty: {
      hasSovereignty: value.sovereignty && value.sovereignty.hasSovereignty === true,
      hubID: value.sovereignty && value.sovereignty.hubID || null,
      onlineUpgrades: [],
      upgrades: [],
      development: {},
    },
  });
  const mocks = {
    "/common/clone": require(path.join(runtimeRoot, "server/src/common/clone")),
    "/common/numbers": require(path.join(runtimeRoot, "server/src/common/numbers")),
    "/common/random": { random: () => 0.5 },
    "/utils/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "/config": { universeSiteCountDefault: 1, universeSiteCountsByFamily: {}, miningGeneratedIceSiteLifetimeMinutes: 1440 },
    "/space/worldData": {
      getSolarSystemByID: (id) => systemRecords.get(Number(id)) || null,
      getSolarSystems: () => [...systemRecords.values()],
      getAsteroidBeltsForSystem: () => [], getCelestialsForSystem: () => [], getStationsForSystem: () => [], getStargatesForSystem: () => [],
    },
    "/dungeon/dungeonAuthority": authority,
    "/dungeon/dungeonRuntime": dungeonRuntime || { listInstancesBySystem: () => [], listInstancesByLifecycle: () => [], listUniversePersistentTerminalInstances: () => [], reconcileUniverseSeededInstances: () => ({}), tickRuntime: () => [], rotateUniversePersistentInstances: () => ({}) },
    "/dungeon/dungeonRuntimeState": {},
    "/exploration/wormholes/wormholeAuthority": { getSystemClassID: () => null },
    "/dungeon/dungeonSiteAdapter": { buildSiteKey: (provider, systemID, siteID) => `${provider}:${systemID}:${siteID}` },
    "/dungeon/dungeonSiteSpawnPolicy": {
      POLICY_VERSION: 1,
      buildRuntimeSystemPolicyContext: (_id, value) => normalizePolicyContext(value),
      buildSelectionMetadata: (value) => value || { allowed: true },
      evaluateSiteSpawnPolicy: () => ({ allowed: true, reason: "test" }),
      getPolicyDescriptor: () => ({}), hasOnlineUpgradeCategory: () => false,
      isLocallyScopedPirateSpawnFamily: () => false, isRuledSpawnFamily: () => false,
      normalizePolicyContext,
    },
    "/exploration/signatures/signaturePlacement": { buildAnchorRelativeSignaturePlacement: () => ({ position: { x: 1000, y: 2000, z: 3000 }, anchorItemID: 0, anchorDistanceMeters: 0 }) },
    "/trigDrifter/trigDrifterSpawnAuthority": { getSystemList: () => [] },
    "/mining/miningResourceSiteService": { buildGeneratedResourceSiteDefinition: () => null, buildGeneratedResourceSiteDefinitionsForSystem: () => [], resetSceneGeneratedResourceSites: () => ({ success: true }), resolveGeneratedMiningEntityDescriptor: () => null },
    "/mining/iceSystemAuthority": { getIceSystemAuthorityRow: () => null, listIceSystemIDs: () => [] },
    "/mining/oreAnomalySecurityAuthority": { AUTHORITY_VERSION: 1, allocateTemplatesForSystem: () => ({ assignments: [] }), assertAuthority: () => true, isEligibleSecurityTier: () => true, listEligibleTemplatesForSystem: () => [], resolveSecurityTierForSystemID: () => "test", validateAuthority: () => ({ valid: true, errors: [] }) },
    "/mining/miningRuntimeState": { readPersistedSystemEntities: () => ({}), removePersistedSystemEntity: () => true, writePersistedSystemEntity: () => true },
    "/sovereignty/sovState": { listAllAllianceSystems: () => [] },
  };
  const universe = compileSourceModule(path.join(runtimeRoot, transforms.TARGET), transforms.transformUniverseRuntime(fs.readFileSync(path.join(runtimeRoot, transforms.TARGET), "utf8"), rules.siteIDBases), mocks);
  return { universe, systemRecords };
}

function findSystemFor(family, band, desired) {
  const securityStatus = band === "highsec" ? 0.9 : band === "lowsec" ? 0.1 : -0.5;
  for (let id = 30010000; id < 30020000; id += 1) {
    if (api.slotSpawnsInSystem(id, family, band, 0) === desired) return { solarSystemID: id, securityStatus, regionID: 10000002 };
  }
  throw new Error("no deterministic fixture system found");
}

const universeHarness = createUniverseHarness();
test("integrated transformed planner includes deterministic accepted rolls", () => { const row = findSystemFor("moon_r4", "highsec", true); universeHarness.systemRecords.set(row.solarSystemID, row); assert.ok(universeHarness.universe._testing.resolveSystemSitePlan(row.solarSystemID, { families: ["moon_r4"] }).some((entry) => entry.family === "moon_r4")); });
test("integrated transformed planner excludes failed deterministic rolls", () => { const row = findSystemFor("moon_r4", "highsec", false); universeHarness.systemRecords.set(row.solarSystemID, row); assert.deepStrictEqual(universeHarness.universe._testing.resolveSystemSitePlan(row.solarSystemID, { families: ["moon_r4"] }), []); });
test("integrated planner excludes highsec R16", () => { const row = findSystemFor("moon_r16", "lowsec", true); row.securityStatus = 0.9; universeHarness.systemRecords.set(row.solarSystemID, row); assert.deepStrictEqual(universeHarness.universe._testing.resolveSystemSitePlan(row.solarSystemID, { families: ["moon_r16"] }), []); });
test("integrated planner excludes wormholes", () => { const row = { solarSystemID: 31000001, securityStatus: -1, regionID: 11000001 }; universeHarness.systemRecords.set(row.solarSystemID, row); assert.deepStrictEqual(universeHarness.universe._testing.resolveSystemSitePlan(row.solarSystemID, { families: ["moon_r4"] }), []); });
test("integrated planner excludes Pochven through profile scope", () => { const row = { solarSystemID: 30000004, securityStatus: -1, regionID: 10000070 }; universeHarness.systemRecords.set(row.solarSystemID, row); assert.deepStrictEqual(universeHarness.universe._testing.resolveSystemSitePlan(row.solarSystemID, { families: ["moon_r4"] }), []); });
test("integrated desired-definition path produces nonzero deterministic site identity", () => { const row = findSystemFor("moon_r8", "highsec", true); universeHarness.systemRecords.set(row.solarSystemID, row); const result = universeHarness.universe.listDesiredUniverseDungeonSiteDefinitions([row.solarSystemID], 1000, { families: ["moon_r8"] }); assert.strictEqual(result.definitions.length, 1); assert.ok(result.definitions[0].metadata.siteID > 0 && result.definitions[0].siteKey.includes(String(result.definitions[0].metadata.siteID))); });

function createRepository(initial = {}) {
  let table = clone(initial);
  const parts = (suffix) => String(suffix).split("/").filter(Boolean);
  return {
    read(_tableName, suffix) { let value = table; for (const key of parts(suffix)) value = value && value[key]; return { success: true, data: clone(value) }; },
    write(_tableName, suffix, value) { const keys = parts(suffix); if (!keys.length) table = clone(value); else { let cursor = table; for (const key of keys.slice(0, -1)) cursor = cursor[key] || (cursor[key] = {}); cursor[keys.at(-1)] = clone(value); } return { success: true }; },
    remove(_tableName, suffix) { const keys = parts(suffix); let cursor = table; for (const key of keys.slice(0, -1)) cursor = cursor && cursor[key]; if (!cursor || !Object.prototype.hasOwnProperty.call(cursor, keys.at(-1))) return { success: false, errorMsg: "ENTRY_NOT_FOUND" }; delete cursor[keys.at(-1)]; return { success: true }; },
    snapshot: () => clone(table),
  };
}

function createUpstreamRuntimeHarness() {
  const repo = createRepository({ version: 1, nextInstanceSequence: 1, instancesByID: {}, universeReconcileMeta: { version: 1 } });
  const stateFile = path.join(runtimeRoot, "server/src/services/dungeon/dungeonRuntimeState.js");
  const runtimeState = loadSourceModule(stateFile, {
    "/gameStore/tableRepository": { createTableRepository: () => repo },
    "/gameStore": { readPersisted: repo.read.bind(repo) },
    "/config/productionMissionPolicy": { isRetiredMissionTemplateIdentifier: () => false },
    "/agent/missionAuthority": { isRetiredOrdinaryEncounterMissionForAgent: () => false },
  });
  const runtimeFile = path.join(runtimeRoot, "server/src/services/dungeon/dungeonRuntime.js");
  const runtime = loadSourceModule(runtimeFile, {
    "/utils/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "/dungeon/dungeonAuthority": authorityFacade(),
    "/dungeon/dungeonRuntimeState": runtimeState,
  });
  return { repo, runtime, runtimeState };
}

const upstream = createUpstreamRuntimeHarness();
const integrated = createUniverseHarness(upstream.runtime);
const lifecycleSystem = findSystemFor("moon_r4", "highsec", true);
integrated.systemRecords.set(lifecycleSystem.solarSystemID, lifecycleSystem);
const lifecycleDefinition = integrated.universe.listDesiredUniverseDungeonSiteDefinitions([lifecycleSystem.solarSystemID], 1_000, { families: ["moon_r4"] }).definitions[0];
test("Moon naming does not change templateContentHash or definitionHash", () => {
  const historicalHarness = createUniverseHarness(null, historicalNamePayload);
  historicalHarness.systemRecords.set(lifecycleSystem.solarSystemID, lifecycleSystem);
  const historicalDefinition = historicalHarness.universe.listDesiredUniverseDungeonSiteDefinitions([lifecycleSystem.solarSystemID], 1_000, { families: ["moon_r4"] }).definitions[0];
  assert.strictEqual(lifecycleDefinition.metadata.definitionHash, historicalDefinition.metadata.definitionHash);
});
let firstMoonInstanceID = 0;
let firstMoonExpiryMs = 0;
test("upstream reconciliation creates Moon instance", () => { const report = upstream.runtime.reconcileUniverseSeededInstances([lifecycleDefinition], { systemIDs: [lifecycleSystem.solarSystemID], siteFamilyFilter: ["moon_r4"], siteOriginFilter: ["universe_dungeon"], nowMs: 1000 }); assert.strictEqual(report.createdCount, 1); assert.strictEqual(upstream.runtime.listInstancesByFamily("moon_r4").length, 1); });
test("repeat upstream reconciliation creates no duplicate", () => { const report = upstream.runtime.reconcileUniverseSeededInstances([lifecycleDefinition], { systemIDs: [lifecycleSystem.solarSystemID], siteFamilyFilter: ["moon_r4"], siteOriginFilter: ["universe_dungeon"], nowMs: 1001 }); assert.strictEqual(report.createdCount, 0); assert.strictEqual(report.retainedCount, 1); });
test("new Moon instance is source-less and active with the accepted expiry", () => { const instance = upstream.runtime.listInstancesByFamily("moon_r4", { full: true })[0]; firstMoonInstanceID = instance.instanceID; firstMoonExpiryMs = instance.timers.expiresAtMs; assert.strictEqual(instance.sourceDungeonID, null); assert.strictEqual(instance.lifecycleState, "active"); assert.strictEqual(firstMoonExpiryMs - instance.timers.createdAtMs, 1440 * 60 * 1000); });
test("upstream tick moves expired Moon instance to terminal state", () => { const report = upstream.runtime.tickRuntime({ nowMs: firstMoonExpiryMs, lifecycleReason: "expired", systemIDs: [lifecycleSystem.solarSystemID], universePersistentOnly: true }); const terminal = upstream.runtime.listUniversePersistentTerminalInstances({ full: true }); assert.strictEqual(report.expiredCount, 1); assert.strictEqual(terminal.length, 1); assert.strictEqual(terminal[0].instanceID, firstMoonInstanceID); });
test("terminal Moon exposes an immediately due rotation boundary", () => { const boundary = integrated.universe.getUniversePersistentLifecycleBoundary(firstMoonExpiryMs, { systemIDs: [lifecycleSystem.solarSystemID] }); assert.strictEqual(boundary.instanceID, firstMoonInstanceID); assert.ok(boundary.boundaryAtMs <= firstMoonExpiryMs); });
test("upstream rotation replaces terminal Moon with a new sequence", () => { const report = integrated.universe.advanceUniversePersistentSites({ nowMs: firstMoonExpiryMs, refreshLoadedScenes: false, systemIDs: [lifecycleSystem.solarSystemID] }); const active = upstream.runtime.listInstancesByFamily("moon_r4", { full: true }); assert.strictEqual(report.rotatedCount, 1); assert.strictEqual(active.length, 1); assert.ok(active[0].instanceID > firstMoonInstanceID); assert.strictEqual(active[0].lifecycleState, "active"); });
test("definition hash change replaces with new upstream sequence", () => { const changed = clone(lifecycleDefinition); changed.metadata.definitionHash += ":v-next"; const oldID = upstream.runtime.listInstancesByFamily("moon_r4")[0].instanceID; const report = upstream.runtime.reconcileUniverseSeededInstances([changed], { systemIDs: [lifecycleSystem.solarSystemID], siteFamilyFilter: ["moon_r4"], siteOriginFilter: ["universe_dungeon"], nowMs: 1002 }); const newID = upstream.runtime.listInstancesByFamily("moon_r4")[0].instanceID; assert.strictEqual(report.replacedCount, 1); assert.ok(newID > oldID); });
test("temporary repository rehydrates Moon instance", () => { const before = upstream.runtime.listInstancesByFamily("moon_r4", { full: true }); upstream.runtime.clearRuntimeCache(); assert.deepStrictEqual(upstream.runtime.listInstancesByFamily("moon_r4", { full: true }), before); });
test("disabled retirement removes active Moon through upstream reconcile", () => { const context = { enabled: false, rules, templateIDs: Object.fromEntries(families.map((family) => [family, snapshots.templatesByFamily[family].templateID])) }; const report = lifecycle.retire(upstream.runtime, context); assert.strictEqual(report.success, true); assert.strictEqual(upstream.runtime.listInstancesByFamily("moon_r4").length, 0); });

function fakeRetirementRuntime(instances) {
  let rows = clone(instances);
  return {
    listInstancesByFamily: (family) => clone(rows.filter((row) => row.siteFamily === family)),
    reconcileUniverseSeededInstances: (_defs, options) => { const preserved = new Set(options.preserveSiteKeys || []); const before = rows.length; rows = rows.filter((row) => row.siteOrigin !== "universe_dungeon" || !options.siteFamilyFilter.includes(row.siteFamily) || preserved.has(row.siteKey)); return { removedCount: before - rows.length, replacedCount: 0 }; },
    rows: () => clone(rows),
  };
}
const templateIDs = Object.fromEntries(families.map((family) => [family, snapshots.templatesByFamily[family].templateID]));
let fixtureSequence = 0;
function fixtureInstance({ family = "moon_r4", templateID = templateIDs.moon_r4, state = "active", origin = "universe_dungeon", siteID = null, current = true } = {}) {
  const systemID = 30000001;
  const actualSiteID = siteID || rules.siteIDBases[family] + systemID * 1000 + 1;
  fixtureSequence += 1;
  return { instanceID: fixtureSequence, siteKey: `sceneAnomalySite:${systemID}:${actualSiteID}:${templateID}`, templateID, siteFamily: family, siteOrigin: origin, solarSystemID: systemID, lifecycleState: state, metadata: { siteID: actualSiteID, slotIndex: 0, spawnFamilyKey: current ? family : "wrong" }, spawnState: { siteID: actualSiteID, slotIndex: 0, spawnFamilyKey: family }, runtimeFlags: { universeSeeded: true, universePersistent: true } };
}
test("disabled retirement removes active and terminal owned rows", () => { const runtime = fakeRetirementRuntime([fixtureInstance(), fixtureInstance({ state: "despawned" })]); const report = lifecycle.retire(runtime, { enabled: false, rules, templateIDs }); assert.strictEqual(report.removed, 2); assert.strictEqual(runtime.rows().length, 0); });
test("disabled retirement recognizes legacy donor template rows", () => { const runtime = fakeRetirementRuntime([fixtureInstance({ templateID: "client-dungeon:5524", state: "despawned" })]); assert.strictEqual(lifecycle.retire(runtime, { enabled: false, rules, templateIDs }).removed, 1); });
test("disabled retirement removes Moon only and preserves official ore", () => { const official = { ...fixtureInstance({ family: "ore", templateID: "client-dungeon:5524", siteID: 5830000000001 }), sourceDungeonID: 5524 }; const runtime = fakeRetirementRuntime([fixtureInstance(), official]); const report = lifecycle.retire(runtime, { enabled: false, rules, templateIDs }); assert.strictEqual(report.removed, 1); assert.deepStrictEqual(runtime.rows(), [official]); });
test("retirement preserves same-family non-universe rows", () => { const runtime = fakeRetirementRuntime([fixtureInstance({ origin: "mission" })]); lifecycle.retire(runtime, { enabled: false, rules, templateIDs }); assert.strictEqual(runtime.rows().length, 1); });
test("enabled startup preserves current and removes obsolete Moon", () => { const current = fixtureInstance(); const legacy = fixtureInstance({ templateID: "client-dungeon:5524", state: "despawned" }); const runtime = fakeRetirementRuntime([current, legacy]); const report = lifecycle.retire(runtime, { enabled: true, rules, templateIDs }); assert.strictEqual(report.removed, 1); assert.strictEqual(runtime.rows()[0].templateID, templateIDs.moon_r4); });
test("upgrade retention preserves only active historical-source current rows", () => {
  const historical = { ...fixtureInstance(), sourceDungeonID: 5524 };
  const official = { ...fixtureInstance({ family: "ore", templateID: "client-dungeon:5524", siteID: 5830000000001 }), sourceDungeonID: 5524 };
  const rows = [historical, official];
  const calls = [];
  const runtime = {
    listInstancesByFamily: (family) => clone(rows.filter((row) => row.siteFamily === family)),
    reconcileUniverseSeededInstances(definitions, options) { calls.push({ definitions, options }); return { retainedCount: 1 }; },
  };
  const installation = lifecycle.installUpgradeRetention(runtime, { enabled: true, rules, templateIDs });
  try {
    runtime.reconcileUniverseSeededInstances([{ templateID: historical.templateID, siteFamily: "moon_r4", siteKey: historical.siteKey }], {});
    assert.deepStrictEqual(calls[0].options.preserveSiteKeys, [historical.siteKey]);
    assert.ok(!calls[0].options.preserveSiteKeys.includes(official.siteKey));
  } finally {
    installation.restore();
  }
});
test("successful retirement leaves no unsettled terminal Moon boundary", () => { const runtime = fakeRetirementRuntime([fixtureInstance({ state: "despawned" })]); lifecycle.retire(runtime, { enabled: false, rules, templateIDs }); assert.strictEqual(runtime.rows().find((row) => row.lifecycleState === "despawned"), undefined); });
test("lifecycle scheduler overlay retires before bind", () => { const order = []; const globalSite = { bindDurableScheduler() { order.push("bind"); return true; } }; const runtime = fakeRetirementRuntime([fixtureInstance({ state: "despawned" })]); const localApi = runtimeApiModule.createRuntimeApi({ enabled: false, rules, version: "test" }); const installation = lifecycle.install(globalSite, { api: localApi, enabled: false, log: () => order.push("retire"), rules, runtimeRoot, templateIDs, dungeonRuntime: runtime }); try { globalSite.bindDurableScheduler({}); assert.deepStrictEqual(order, ["retire", "bind"]); assert.strictEqual(localApi.getRetirementStatus().success, true); } finally { installation.restore(); } });

function loadSchedulerFactory() {
  return loadSourceModule(path.join(runtimeRoot, "server/src/services/dungeon/globalSiteSchedulerRuntime.js"), {
    "/gameStore": { flushTableAsync() {} },
    "/utils/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "/dungeon/dungeonRuntime": { registerInstanceChangeListener() {}, unregisterInstanceChangeListener() {} },
    "/dungeon/dungeonRuntimeState": { DUNGEON_RUNTIME_TABLE: "dungeonRuntime" },
    "/dungeon/dungeonUniverseRuntime": { getUniversePersistentLifecycleBoundary: () => null },
    "/mining/miningRuntimeState": { MINING_RUNTIME_TABLE: "miningRuntime" },
    "/scheduler/scheduledJobStates": { isDeadLetteredJob: (job) => Boolean(job && job.state === "dead-letter") },
  }).createGlobalSiteSchedulerRuntime;
}

testAsync("disabled cleanup reconciliation cancels stale durable Moon jobs", async () => {
  const canceled = [];
  const factory = loadSchedulerFactory();
  const owner = factory({
    database: { flushTableAsync() {} },
    log: { warn() {} },
    dungeonRuntime: { registerInstanceChangeListener() {}, unregisterInstanceChangeListener() {} },
    dungeonRuntimeState: { DUNGEON_RUNTIME_TABLE: "dungeonRuntime" },
    dungeonUniverseRuntime: { getUniversePersistentLifecycleBoundary: () => null },
    miningRuntimeState: { MINING_RUNTIME_TABLE: "miningRuntime" },
  });
  const scheduler = {
    schedule: async () => {},
    cancel: async (jobID) => { canceled.push(jobID); },
    list: async () => [
      { jobID: "global-site:77:rotation:1000:advance", type: "global-site.lifecycle" },
      { jobID: "unrelated", type: "other" },
    ],
  };
  owner.bindDurableScheduler(scheduler);
  const result = await owner.reconcileDurableGlobalSites({ nowMs: 2000 });
  assert.strictEqual(result.scheduled, 0);
  assert.deepStrictEqual(canceled, ["global-site:77:rotation:1000:advance"]);
});

testAsync("durable lifecycle settles its due Moon boundary", async () => {
  let boundary = { boundaryAtMs: 5000, instanceID: 88, phase: "expiry" };
  const factory = loadSchedulerFactory();
  const owner = factory({
    database: { flushTableAsync() {} },
    log: { warn() {} },
    dungeonRuntime: { getInstance: () => ({ instanceID: 88, solarSystemID: 30000001 }), registerInstanceChangeListener() {}, unregisterInstanceChangeListener() {} },
    dungeonRuntimeState: { DUNGEON_RUNTIME_TABLE: "dungeonRuntime" },
    dungeonUniverseRuntime: {
      getUniversePersistentLifecycleBoundary: () => boundary,
      advanceUniversePersistentSites: () => { boundary = null; return { affectedSystemIDs: [], expiredCount: 1, rotatedCount: 1 }; },
    },
    miningRuntimeState: { MINING_RUNTIME_TABLE: "miningRuntime" },
  });
  owner.bindDurableScheduler({ schedule: async () => {}, cancel: async () => {}, list: async () => [] });
  const job = owner.buildDurableGlobalSiteLifecycleJob(5000);
  const result = await owner.handleDurableGlobalSiteLifecycle(job, { nowMs: 5000 });
  assert.deepStrictEqual(result, { affectedSystemIDs: [], expired: 1, rotated: 1, stale: false });
});

test("scan overlay maps all Moon families through vendor ore attribute", () => { const authority = { getScanStrengthAttribute: (family) => ({ ore: 211, data: 208 }[family] || 0) }; const report = scanOverlay.install(authority, rules); assert.strictEqual(report.ok, true); assert.ok(families.every((family) => authority.getScanStrengthAttribute(family) === 211)); });
test("scan overlay leaves ordinary families unchanged", () => { const authority = { getScanStrengthAttribute: (family) => ({ ore: 211, data: 208 }[family] || 0) }; scanOverlay.install(authority, rules); assert.strictEqual(authority.getScanStrengthAttribute("data"), 208); });

function createSiteServiceHarness() {
  const registrations = [];
  const miningState = { updateMineableState: (_scene, entity, state) => { registrations.push({ entity, state }); return { success: true }; } };
  const service = loadSourceModule(path.join(runtimeRoot, "server/src/services/dungeon/dungeonUniverseSiteService.js"), {
    "/common/clone": require(path.join(runtimeRoot, "server/src/common/clone")),
    "/common/numbers": require(path.join(runtimeRoot, "server/src/common/numbers")),
    "/utils/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "/baseService": class BaseService {},
    "/dungeon/dungeonAuthority": authorityFacade(),
    "/dungeon/dungeonRuntime": {
      ensureTemplateRuntimeState: (_id, options) => options.instance || null,
      getInstance: () => null,
      listInstancesBySystem: () => [],
      listActiveInstancesBySystem: () => [],
      mergeSpawnState: () => null,
    },
    "/dungeon/dungeonTrackingRuntime": {},
    "/dungeon/dungeonVisibilityPolicy": {},
    "/agent/loadedMissionRuntime": {},
    "/identity/entityID": { entityIDsEqual: (a, b) => Number(a) === Number(b), getEntityIDText: String, normalizePersistentEntityID: Number },
    "/identity/interactionScope.js": { canEntitiesInteractLocally: () => true },
    "/presentation/siteEnvironment": { DESTINY_BOOTSTRAP_DELIVERY_ADDBALLS2: "addballs2", resolveSiteEnvironmentPropDestinyPresentation: () => ({}) },
    "/exploration/explorationAuthority": { getScanStrengthAttribute: () => 211 },
    "/inventory/itemTypeRegistry": {
      resolveItemByName: () => null,
      resolveItemByTypeID: (typeID) => ({ typeID: Number(typeID), groupID: Number(typeID) >= 64063 ? 450 : 1920, categoryID: Number(typeID) >= 64063 ? 2 : 25, graphicID: Number(typeID) >= 64063 ? 1 : 0, radius: 900, volume: 10 }),
    },
    "/fitting/liveFittingState": { getTypeAttributeValue: () => 0 },
    "/npc/npcSentryPolicy": { isDestructibleNpcSentry: () => false },
    "/inventory/itemStore": { grantItemsToOwnerLocation: () => ({ success: true, data: {} }), findItemById: () => null, getAllItems: () => [], listContainerItems: () => [], ITEM_FLAGS: {}, removeInventoryItem: () => true, updateInventoryItem: () => true },
    "/mining/miningRuntimeState": miningState,
  });
  return { registrations, service };
}

const siteServiceHarness = createSiteServiceHarness();
const materializedTemplate = effectivePayload.templatesByID[snapshots.templatesByFamily.moon_r64.templateID];
const materializedSiteID = rules.siteIDBases.moon_r64 + 32000001 * 1000 + 1;
const materializedInstance = { instanceID: 77, templateID: materializedTemplate.templateID, siteFamily: "moon_r64", siteKind: "anomaly", siteOrigin: "universe_dungeon", metadata: { siteID: materializedSiteID }, spawnState: { populationHints: materializedTemplate.populationHints }, runtimeFlags: { universeSeeded: true, universePersistent: true } };
const materializedSiteEntity = { itemID: materializedSiteID, position: { x: 0, y: 0, z: 0 } };
test("production materializer builds sixteen Moon rocks", () => { const rocks = siteServiceHarness.service._testing.buildMiningRockEntities(materializedInstance, materializedSiteEntity, materializedTemplate.populationHints); assert.strictEqual(rocks.length, 16); assert.strictEqual(new Set(rocks.map((rock) => rock.itemID)).size, 16); assert.ok(rocks.every((rock) => rock.itemID > 0 && Number.isSafeInteger(rock.itemID) && rock.miningYieldKind === "ore" && !Object.prototype.hasOwnProperty.call(rock, "beltID"))); });
test("production materializer retains R64 quantities and four ore types", () => { const rocks = siteServiceHarness.service._testing.buildMiningRockEntities(materializedInstance, materializedSiteEntity, materializedTemplate.populationHints); assert.strictEqual(new Set(rocks.map((rock) => rock.miningYieldTypeID)).size, 4); assert.ok(rocks.every((rock) => rock.miningOriginalQuantity === 2000 && rock.miningRemainingQuantity === 2000)); });
test("production materialization registers all Moon rocks in mining state", () => {
  const scene = { systemID: 32000001, staticEntities: [], staticEntitiesByID: new Map(), addStaticEntity(entity) { this.staticEntities.push(entity); this.staticEntitiesByID.set(Number(entity.itemID), entity); return true; } };
  const summary = siteServiceHarness.service._testing.materializeSiteContents(scene, materializedInstance, materializedSiteEntity, materializedTemplate, { nowMs: 1000, spawnEncounters: false });
  assert.strictEqual(summary.miningRocksSpawned, 16);
  assert.strictEqual(siteServiceHarness.registrations.length, 16);
  assert.ok(siteServiceHarness.registrations.every((entry) => entry.state.remainingQuantity === 2000 && entry.state.yieldKind === "ore"));
});
test("official historical template materialization remains unchanged", () => {
  const template = effectivePayload.templatesByID["client-dungeon:5524"];
  const instance = { instanceID: 78, templateID: template.templateID, siteFamily: "ore", siteKind: "anomaly", siteOrigin: "client_dungeon", metadata: { siteID: materializedSiteID + 1 }, spawnState: { populationHints: template.populationHints }, runtimeFlags: { universeSeeded: true, universePersistent: true } };
  const siteEntity = { itemID: materializedSiteID + 1, position: { x: 0, y: 0, z: 0 } };
  const rocks = siteServiceHarness.service._testing.buildMiningRockEntities(instance, siteEntity, template.populationHints);
  assert.strictEqual(rocks.length, 20);
  assert.deepStrictEqual([...new Set(rocks.map((rock) => rock.miningYieldTypeID))].sort((a, b) => a - b), [17425, 17428, 17867, 17869]);
  assert.ok(rocks.every((rock) => !Object.prototype.hasOwnProperty.call(rock, "beltID")));
});
test("mining math clamps an oversized Solo-scaled cycle to the final Moon rock", () => { const miningMath = loadSourceModule(path.join(runtimeRoot, "server/src/services/mining/miningMath.js"), { "/common/numbers": require(path.join(runtimeRoot, "server/src/common/numbers")), "/fitting/liveFittingState": { getTypeAttributeValue: () => 0 } }); const result = miningMath.computeMiningResult({ asteroidQuantity: 5, clampFactor: 1, efficiency: 1, unitVolume: 1, volume: 300, wasteProbability: 0, critProbability: 0, random: () => 0.5 }); assert.strictEqual(result.normalQuantity, 5); assert.strictEqual(result.getTotalDepletedQuantity(), 5); });
test("mining randomized remainder remains deterministic under injected RNG", () => { const miningMath = loadSourceModule(path.join(runtimeRoot, "server/src/services/mining/miningMath.js"), { "/common/numbers": require(path.join(runtimeRoot, "server/src/common/numbers")), "/fitting/liveFittingState": { getTypeAttributeValue: () => 0 } }); assert.strictEqual(miningMath.computeMiningResult({ asteroidQuantity: 10, clampFactor: 1, efficiency: 1, unitVolume: 1, volume: 2.5, random: () => 0.4 }).normalQuantity, 3); assert.strictEqual(miningMath.computeMiningResult({ asteroidQuantity: 10, clampFactor: 1, efficiency: 1, unitVolume: 1, volume: 2.5, random: () => 0.6 }).normalQuantity, 2); });
test("Solo module and drone yields scale exactly once for official and Moon rocks", () => {
  const { createMiningBalance } = require(path.join(runtimeRoot, "mods/soloProgressionBalance/lib/miningBalance"));
  const { installDroneDogma, installMiningDogma } = require(path.join(runtimeRoot, "mods/soloProgressionBalance/lib/overlays"));
  const balance = createMiningBalance({ miningYieldScale: 3, miningDroneYieldScale: 3, miningHoldScale: 3 });
  const dogma = { buildMiningModuleSnapshot: () => ({ miningAmountM3: 100, moduleAttributes: { 77: 100 } }) };
  const droneDogma = {
    resolveDroneOperationalAttributes: () => ({ 77: 20 }),
    resolveDroneMiningSnapshot: () => ({ miningAmountM3: 20 }),
  };
  installMiningDogma(dogma, balance);
  installDroneDogma(droneDogma, balance);
  const controller = { pilotCharacterID: 9 };
  const populationHintsBeforeSolo = clone(materializedTemplate.populationHints);
  for (const target of [{ siteFamily: "ore" }, { siteFamily: "moon_r64", dungeonMaterializedMiningRock: true }]) {
    assert.strictEqual(dogma.buildMiningModuleSnapshot({ characterID: 9, target }).miningAmountM3, 300);
    assert.strictEqual(dogma.buildMiningModuleSnapshot({ characterID: 9, target }).miningAmountM3, 300);
    assert.strictEqual(droneDogma.resolveDroneOperationalAttributes(target, controller)[77], 60);
    assert.strictEqual(droneDogma.resolveDroneMiningSnapshot(target, controller).miningAmountM3, 60);
  }
  assert.deepStrictEqual(materializedTemplate.populationHints, populationHintsBeforeSolo);
});
test("generic mining pipeline transfers yield before applying depletion", () => { const source = fs.readFileSync(path.join(runtimeRoot, "server/src/services/mining/miningRuntime.js"), "utf8"); const transfer = source.indexOf("const grantResult = grantItemsToCharacterLocation("); const delta = source.indexOf("const deltaResult = applyMiningDelta(", transfer); assert.ok(transfer > 0 && delta > transfer && source.slice(transfer, delta).includes("mineableState.yieldTypeID")); });
test("Four Mode multiplier remains beltID-scoped", () => { const source = fs.readFileSync(path.join(runtimeRoot, "mods/fourModeAsteroidBelts/lib/sourceTransforms.js"), "utf8"); assert.ok(source.includes("toInt(entity && entity.beltID, 0) > 0")); });
test("Four Mode refresh selects only belt-owned entities and state", () => { const source = fs.readFileSync(path.join(runtimeRoot, "mods/fourModeAsteroidBelts/lib/refreshCoordinator.js"), "utf8"); assert.ok(source.includes("toInt(entity && entity.beltID) > 0") && source.includes("toInt(state && state.beltID) > 0") && source.includes("toInt(job.persistedByEntityID[id] && job.persistedByEntityID[id].beltID) > 0")); });
test("Moon targets do not overlap Four Mode targets", () => { const moon = new Set(Object.values(viability.PREIMAGES).map((row) => row.relative)); const four = ["server/src/space/asteroids/asteroidService.js", "server/src/services/mining/miningRuntimeState.js", "server/src/services/chat/chatCommands.js"]; assert.ok(four.every((target) => !moon.has(target))); });
test("Moon targets do not overlap Solo targets", () => { const moon = new Set(Object.values(viability.PREIMAGES).map((row) => row.relative)); const solo = ["server/src/services/fitting/liveFittingState.js", "server/src/space/runtime/moduleAttributes.js", "server/src/services/drone/droneRuntime.js", "server/src/services/mining/miningDogma.js", "server/src/services/drone/droneDogma.js", "server/src/_secondary/fitting/fittingSnapshotBuilder.js", "server/src/services/dogma/dogmaService.js"]; assert.ok(solo.every((target) => !moon.has(target))); });

delete globalThis[Symbol.for(runtimeApiModule.API_SYMBOL)];
test("loader duplicate installation returns the active installation", () => { process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL = "1"; const loader = require("../loader"); const first = loader.install({ runtimeRoot, config: { enabled: true, verbose: false }, rules, systemIDs: [30000001] }); try { assert.strictEqual(loader.install({ runtimeRoot, config: { enabled: true, verbose: false }, rules, systemIDs: [30000001] }), first); } finally { first.rollback(); } });
test("loader failure rolls back and permits retry", () => { const loader = require("../loader"); const first = loader.install({ runtimeRoot, config: { enabled: true, verbose: false }, rules, systemIDs: [30000001] }); const managerPath = path.join(runtimeRoot, viability.PREIMAGES.contentPackManager.relative); try { const manager = require(managerPath); const conflictPayload = clone(baseAuthority); conflictPayload.templatesByID[snapshots.templatesByFamily.moon_r4.templateID] = { siteFamily: "foreign" }; assert.throws(() => manager.applyDungeonContentPacks(conflictPayload, []), /MOON_TEMPLATE_ID_CONFLICT/); assert.strictEqual(first.active, false); const retry = loader.install({ runtimeRoot, config: { enabled: true, verbose: false }, rules, systemIDs: [30000001] }); assert.strictEqual(retry.active, true); retry.rollback(); } finally { first.rollback(); delete require.cache[managerPath]; } });
test("unrelated MODULE_NOT_FOUND does not roll back Moon", () => { const loader = require("../loader"); const installation = loader.install({ runtimeRoot, config: { enabled: true, verbose: false }, rules, systemIDs: [30000001] }); try { assert.throws(() => require("__moon_missing_better_sqlite3_probe__"), (error) => error && error.code === "MODULE_NOT_FOUND"); assert.strictEqual(installation.active, true); } finally { installation.rollback(); } });
test("worker thread ignores the preload", () => { const script = `const { Worker }=require('node:worker_threads'); const file=${JSON.stringify(path.join(modDir, "loader.js"))}; const worker=new Worker(\`const {parentPort}=require('node:worker_threads'); const result=require(\${JSON.stringify(file)}); parentPort.postMessage(result.installation);\`,{eval:true}); worker.once('message',m=>{console.log('WORKER:'+JSON.stringify(m));});`; const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 30000, env: { ...process.env, EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "0" } }); assert.strictEqual(child.status, 0, child.stderr); assert.match(child.stdout, /"reason":"worker-thread"/); });

function assertProductionStartupScenario(scenario, pattern) {
  const child = spawnSync(
    process.execPath,
    [path.join(modDir, "test/productionStartup.js"), scenario],
    {
      encoding: "utf8",
      timeout: 60_000,
      cwd: runtimeRoot,
      env: { ...process.env, EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "1" },
    },
  );
  assert.strictEqual(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, pattern);
}

test("production startup with zero optional packs seeds Moon definitions", () => {
  assertProductionStartupScenario("zero-enabled", /"optionalPackCount":0[\s\S]*"reconciledMoonDefinitionCount":[1-9]/);
});
test("production startup with zero optional packs and Moon disabled seeds none", () => {
  assertProductionStartupScenario("zero-disabled", /"enabled":false[\s\S]*"reconciledMoonDefinitionCount":0/);
});
test("production startup with the exact official ore pack still seeds Moon definitions", () => {
  assertProductionStartupScenario("pack-enabled", /"optionalPackCount":1[\s\S]*"reconciledMoonDefinitionCount":[1-9]/);
});
test("production startup with Moon disabled preserves the exact official ore pack", () => {
  assertProductionStartupScenario("pack-disabled", /"enabled":false[\s\S]*"optionalPackCount":1[\s\S]*"officialPackTemplateCount":199[\s\S]*"reconciledMoonDefinitionCount":0/);
});
test("production startup with an unknown Moon identity conflict fails closed", () => {
  assertProductionStartupScenario("unknown-conflict", /"loaderActive":false[\s\S]*"conflictRejected":true/);
});

test("production planner persists Moon rows through the real gameStore and /sigs path", () => {
  const child = spawnSync(
    process.execPath,
    [path.join(modDir, "test/productionPersistence.js")],
    {
      encoding: "utf8",
      timeout: 120_000,
      cwd: runtimeRoot,
      env: {
        ...process.env,
        EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "0",
      },
    },
  );
  assert.strictEqual(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /"persistedMoonCount":4[\s\S]*"persistedOfficialCount":3[\s\S]*"rehydratedMoonCount":4[\s\S]*"sigsMoonCount":4[\s\S]*"sigsOfficialCount":3[\s\S]*"historicalSourceRetained":true[\s\S]*"replacementSourceDungeonID":null/);
});

const loaders = {
  moon: path.join(modDir, "loader.js"),
  four: path.join(runtimeRoot, "mods/fourModeAsteroidBelts/loader.js"),
  solo: path.join(runtimeRoot, "mods/soloProgressionBalance/loader.js"),
};
const orders = [
  ["moon", "four", "solo"], ["moon", "solo", "four"],
  ["four", "moon", "solo"], ["four", "solo", "moon"],
  ["solo", "moon", "four"], ["solo", "four", "moon"],
];
for (const order of orders) {
  test(`loader order ${order.join(" -> ")}`, () => {
    const childScript = `process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL='1'; const paths=${JSON.stringify(loaders)}; const order=${JSON.stringify(order)}; let moon; for(const name of order){ if(name==='moon'){ const loader=require(paths.moon); moon=loader.install({runtimeRoot:${JSON.stringify(runtimeRoot)},config:{enabled:true,verbose:false},rules:require(${JSON.stringify(path.join(modDir, "data/moonOreSiteRules.json"))}),systemIDs:[30000001,30000002,31000001]}); } else require(paths[name]); } if(!moon.active) throw new Error('moon inactive'); console.log('ORDER_OK');`;
    const child = spawnSync(process.execPath, ["-e", childScript], { encoding: "utf8", timeout: 30000, cwd: runtimeRoot, env: { ...process.env, EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL: "1" } });
    assert.strictEqual(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /ORDER_OK/);
  });
}

delete globalThis[Symbol.for(runtimeApiModule.API_SYMBOL)];
(async () => {
  for (const check of asyncChecks) {
    try {
      await check.operation();
      results.push(check.name);
      console.log(`PASS ${String(results.length).padStart(3, "0")} ${check.name}`);
    } catch (error) {
      failures.push({ name: check.name, error });
      console.error(`FAIL ${check.name}: ${error.stack || error}`);
    }
  }
  if (failures.length > 0) {
    console.error(`\nFAILED ${failures.length} of ${results.length + failures.length}`);
    process.exitCode = 1;
  } else {
    console.log(`\nPASS ${results.length}/${results.length}`);
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
