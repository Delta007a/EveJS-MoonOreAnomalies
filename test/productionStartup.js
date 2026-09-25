"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const runtimeRoot = path.resolve(__dirname, "../../..");
const cleanRoot = path.resolve(runtimeRoot, "../EveJS-0.12.9");
const modDir = path.resolve(__dirname, "..");
const families = ["moon_r4", "moon_r8", "moon_r16", "moon_r32", "moon_r64"];
const fixtureSystems = [
  { solarSystemID: 30004504, securityStatus: -0.006, regionID: 10000057 },
  { solarSystemID: 30004503, securityStatus: -0.001, regionID: 10000057 },
];
const scenario = String(process.argv[2] || "zero-enabled").trim().toLowerCase();
const supportedScenarios = new Set([
  "zero-enabled",
  "zero-disabled",
  "pack-enabled",
  "pack-disabled",
  "unknown-conflict",
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeStaticDataRoot() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moon-production-data-"));
  for (const table of ["dungeonAuthority", "dungeonClientContent"]) {
    const target = path.join(dataRoot, table);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(
      path.join(cleanRoot, "tools/DatabaseCreator/staticTables", table, "data.json"),
      path.join(target, "data.json"),
    );
  }
  return dataRoot;
}

function injectUnknownMoonIdentity(dataRoot) {
  const authorityPath = path.join(dataRoot, "dungeonAuthority", "data.json");
  const payload = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  payload.templatesByID = payload.templatesByID || {};
  payload.templatesByID["evejs-mod:moon-ore:r4:v1"] = {
    templateID: "evejs-mod:moon-ore:r4:v1",
    siteFamily: "fixture_unknown",
  };
  fs.writeFileSync(authorityPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function installOfficialContentPack(manager, packsRoot) {
  manager.installContentPack(
    path.join(cleanRoot, "content-packs/evejs-ore-anomalies-1.1.0.json"),
    { contentPacksRoot: packsRoot },
  );
}

function normalizePolicyContext(value = {}) {
  return {
    securityBand: value.securityBand || "nullsec",
    localPirateFactionKey: "mixed",
    localPirateFactionSource: "production-startup-regression",
    localPirateFactionSpecialSpace: false,
    sovereignty: { hasSovereignty: false, hubID: null, onlineUpgrades: [], upgrades: [], development: {} },
  };
}

function installPlannerDependencyMocks(authority, systemRecords, reconciliations) {
  const previousLoad = Module._load;
  const mocks = {
    "/utils/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "/config": { universeSiteCountDefault: 1, universeSiteCountsByFamily: {}, miningGeneratedIceSiteLifetimeMinutes: 1440 },
    "/space/worldData": {
      getSolarSystemByID: (id) => clone(systemRecords.get(Number(id)) || null),
      getSolarSystems: () => clone([...systemRecords.values()]),
      getAsteroidBeltsForSystem: () => [],
      getCelestialsForSystem: () => [],
      getStationsForSystem: () => [],
      getStargatesForSystem: () => [],
    },
    "/dungeon/dungeonAuthority": authority,
    "/dungeon/dungeonRuntime": {
      listInstancesBySystem: () => [],
      listInstancesByLifecycle: () => [],
      listUniversePersistentTerminalInstances: () => [],
      reconcileUniverseSeededInstances(definitions, options) {
        reconciliations.push({ definitions: clone(definitions), options: clone(options) });
        return { desiredCount: definitions.length, createdCount: definitions.length, retainedCount: 0, replacedCount: 0, removedCount: 0 };
      },
      tickRuntime: () => [],
      rotateUniversePersistentInstances: () => ({}),
    },
    "/dungeon/dungeonRuntimeState": {},
    "/exploration/wormholes/wormholeAuthority": { getSystemClassID: () => null },
    "/dungeon/dungeonSiteAdapter": { buildSiteKey: (provider, systemID, siteID) => `${provider}:${systemID}:${siteID}` },
    "/dungeon/dungeonSiteSpawnPolicy": {
      POLICY_VERSION: 1,
      buildRuntimeSystemPolicyContext: (_id, value) => normalizePolicyContext(value),
      buildSelectionMetadata: (value) => value || { allowed: true },
      evaluateSiteSpawnPolicy: () => ({ allowed: true, reason: "unruled_family" }),
      getPolicyDescriptor: () => ({}),
      hasOnlineUpgradeCategory: () => false,
      isLocallyScopedPirateSpawnFamily: () => false,
      isRuledSpawnFamily: () => false,
      normalizePolicyContext,
    },
    "/exploration/signatures/signaturePlacement": { buildAnchorRelativeSignaturePlacement: () => ({ position: { x: 1, y: 2, z: 3 }, anchorItemID: 0, anchorDistanceMeters: 0 }) },
    "/trigDrifter/trigDrifterSpawnAuthority": { getSystemList: () => [] },
    "/mining/miningResourceSiteService": { buildGeneratedResourceSiteDefinition: () => null, buildGeneratedResourceSiteDefinitionsForSystem: () => [], resetSceneGeneratedResourceSites: () => ({ success: true }), resolveGeneratedMiningEntityDescriptor: () => null },
    "/mining/iceSystemAuthority": { getIceSystemAuthorityRow: () => null, listIceSystemIDs: () => [] },
    "/mining/oreAnomalySecurityAuthority": { AUTHORITY_VERSION: 1, allocateTemplatesForSystem: () => ({ assignments: [] }), assertAuthority: () => true, isEligibleSecurityTier: () => true, listEligibleTemplatesForSystem: () => [], resolveSecurityTierForSystemID: () => "test", validateAuthority: () => ({ valid: true, errors: [] }) },
    "/mining/miningRuntimeState": { readPersistedSystemEntities: () => ({}), removePersistedSystemEntity: () => true, writePersistedSystemEntity: () => true },
    "/sovereignty/sovState": { listAllAllianceSystems: () => [] },
  };
  Module._load = function mockedLoad(request, parent, isMain) {
    if (!(Module.builtinModules.includes(request) || request.startsWith("node:"))) {
      let normalized = String(request).replaceAll("\\", "/");
      try { normalized = String(Module._resolveFilename(request, parent, isMain)).replaceAll("\\", "/"); } catch (_) { /* use request */ }
      const key = Object.keys(mocks).find((suffix) => normalized.endsWith(`${suffix}.js`) || normalized.endsWith(suffix));
      if (key) return mocks[key];
    }
    return previousLoad.apply(this, arguments);
  };
  return () => { if (Module._load !== previousLoad) Module._load = previousLoad; };
}

function run() {
  assert.ok(supportedScenarios.has(scenario), `unsupported scenario: ${scenario}`);
  const dataRoot = makeStaticDataRoot();
  const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moon-production-zero-packs-"));
  const oldDataDir = process.env.EVEJS_GAMESTORE_DATA_DIR;
  const oldPacksDir = process.env.EVEJS_CONTENT_PACKS_DIR;
  process.env.EVEJS_GAMESTORE_DATA_DIR = dataRoot;
  process.env.EVEJS_CONTENT_PACKS_DIR = packsRoot;
  process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL = "1";
  let state = null;
  let restoreMocks = null;
  try {
    if (scenario === "unknown-conflict") {
      injectUnknownMoonIdentity(dataRoot);
    }
    const loader = require(path.join(modDir, "loader"));
    const enabled = !scenario.endsWith("disabled");
    state = loader.install({
      runtimeRoot,
      config: { enabled, verbose: false },
      systemIDs: fixtureSystems.map((row) => row.solarSystemID),
    });
    assert.strictEqual(state.active, true);
    assert.strictEqual(state.enabled, enabled);

    const manager = require(path.join(runtimeRoot, "server/src/contentPacks/contentPackManager"));
    if (scenario.startsWith("pack-")) {
      installOfficialContentPack(manager, packsRoot);
    }
    if (scenario === "unknown-conflict") {
      const authority = require(path.join(runtimeRoot, "server/src/services/dungeon/dungeonAuthority"));
      assert.throws(() => authority.initializeDungeonAuthority(), /MOON_TEMPLATE_ID_CONFLICT/);
      assert.strictEqual(state.active, false);
      console.log("PASS production startup fails closed on an unknown Moon identity conflict");
      console.log(JSON.stringify({ scenario, loaderActive: state.active, enabled, conflictRejected: true }));
      return;
    }
    const loadedPacks = manager.initializeContentPacks();
    assert.strictEqual(loadedPacks.length, scenario.startsWith("pack-") ? 1 : 0);

    const authority = require(path.join(runtimeRoot, "server/src/services/dungeon/dungeonAuthority"));
    authority.initializeDungeonAuthority();
    const payload = authority.getPayload();
    const officialTemplateCount = Object.values(payload.templatesByID)
      .filter((row) => row && row.siteFamily === "ore")
      .length;
    let officialPackTemplateCount = 0;
    if (scenario.startsWith("pack-")) {
      const pack = JSON.parse(fs.readFileSync(
        path.join(cleanRoot, "content-packs/evejs-ore-anomalies-1.1.0.json"),
        "utf8",
      ));
      const packTemplates = pack.payload.dungeon.templatesByID;
      officialPackTemplateCount = Object.keys(packTemplates).length;
      assert.strictEqual(officialPackTemplateCount, 199);
      for (const [templateID, template] of Object.entries(packTemplates)) {
        const { _contentPack, ...effectiveTemplate } = payload.templatesByID[templateID];
        assert.deepStrictEqual(effectiveTemplate, template);
        assert.deepStrictEqual(_contentPack, {
          id: "evejs.ore-anomalies",
          version: "1.1.0",
          packSha256: "43bdf881ca141f166e2795b9aa45799d65c275376acb5030b1deb8cd41df324b",
          payloadSha256: "0f110a78980e47c629a9647a13ac4ec2ef5bac1c4cceaefae344f0140f955afc",
        });
      }
    }
    const moonTemplateCount = Object.values(payload.templatesByID)
      .filter((row) => row && row._moonOreAnomalies)
      .length;
    const moonProfileCount = families.filter((family) => authority.getSpawnProfile(family)).length;
    const moonFamilies = authority.listUniverseSpawnFamilies()
      .filter((family) => family.startsWith("moon_"))
      .sort();
    assert.strictEqual(moonTemplateCount, enabled ? 5 : 0);
    assert.strictEqual(moonProfileCount, enabled ? 5 : 0);
    assert.deepStrictEqual(moonFamilies, enabled ? [...families].sort() : []);
    if (scenario.startsWith("pack-")) assert.strictEqual(officialTemplateCount, 205);

    const reconciliations = [];
    const systemRecords = new Map(fixtureSystems.map((row) => [row.solarSystemID, row]));
    restoreMocks = installPlannerDependencyMocks(authority, systemRecords, reconciliations);
    const universe = require(path.join(runtimeRoot, "server/src/services/dungeon/dungeonUniverseRuntime"));
    const desired = universe.listDesiredUniverseDungeonSiteDefinitions(
      fixtureSystems.map((row) => row.solarSystemID),
      1_000,
      { families },
    );
    if (enabled) assert.ok(desired.definitions.length > 0);
    else assert.strictEqual(desired.definitions.length, 0);
    const ensured = universe.ensureSystemUniversePersistentSites(30004504, {
      includeMining: false,
      force: true,
      nowMs: 1_000,
    });
    assert.strictEqual(ensured.success, true);
    const reconciledMoonDefinitionCount = reconciliations
      .flatMap((entry) => entry.definitions)
      .filter((definition) => definition.siteFamily.startsWith("moon_"))
      .length;
    if (enabled) assert.ok(reconciledMoonDefinitionCount > 0);
    else assert.strictEqual(reconciledMoonDefinitionCount, 0);

    console.log(`PASS production startup ${scenario}`);
    console.log(JSON.stringify({
      scenario,
      loaderActive: state.active,
      enabled: state.enabled,
      optionalPackCount: loadedPacks.length,
      officialTemplateCount,
      officialPackTemplateCount,
      overlayInstalled: state.installedTargets.has("contentPackManager"),
      moonTemplateCount,
      moonProfileCount,
      moonFamilies,
      desiredMoonDefinitionCount: desired.definitions.length,
      reconciliationCount: reconciliations.length,
      reconciledMoonDefinitionCount,
    }));
  } finally {
    if (restoreMocks) restoreMocks();
    if (state) state.rollback();
    if (oldDataDir === undefined) delete process.env.EVEJS_GAMESTORE_DATA_DIR;
    else process.env.EVEJS_GAMESTORE_DATA_DIR = oldDataDir;
    if (oldPacksDir === undefined) delete process.env.EVEJS_CONTENT_PACKS_DIR;
    else process.env.EVEJS_CONTENT_PACKS_DIR = oldPacksDir;
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(packsRoot, { recursive: true, force: true });
  }
}

run();
