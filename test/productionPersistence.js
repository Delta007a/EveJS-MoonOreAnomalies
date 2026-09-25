"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modDir = path.resolve(__dirname, "..");
const runtimeRoot = path.resolve(modDir, "../..");
const sourceDataDir = path.join(runtimeRoot, "_local/gameStore/data");
const temporaryStoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-moon-persistence-"));
const temporaryDataDir = path.join(temporaryStoreRoot, "data");
const temporaryPacksRoot = path.join(temporaryStoreRoot, "content-packs");
const officialPackSource = path.join(runtimeRoot, "content-packs/evejs-ore-anomalies-1.1.0.json");

assert.ok(
  fs.existsSync(path.join(sourceDataDir, "solarSystems/data.json")),
  `generated static gameStore data is unavailable: ${sourceDataDir}`,
);
fs.symlinkSync(sourceDataDir, temporaryDataDir, "junction");
const officialPackTarget = path.join(
  temporaryPacksRoot,
  "packs/evejs.ore-anomalies/1.1.0/pack.json",
);
fs.mkdirSync(path.dirname(officialPackTarget), { recursive: true });
fs.copyFileSync(officialPackSource, officialPackTarget);
fs.writeFileSync(
  path.join(temporaryPacksRoot, "installed.json"),
  `${JSON.stringify({
    schema: "evejs.content-pack-registry.v1",
    installed: [{
      id: "evejs.ore-anomalies",
      version: "1.1.0",
      packSha256: "43bdf881ca141f166e2795b9aa45799d65c275376acb5030b1deb8cd41df324b",
    }],
  })}\n`,
  "utf8",
);

process.env.EVEJS_GAMESTORE_DATA_DIR = temporaryDataDir;
process.env.EVEJS_CONTENT_PACKS_DIR = temporaryPacksRoot;
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "world";
process.env.EVEJS_MOON_ORE_ANOMALIES = "1";
process.env.EVEJS_MOON_ORE_ANOMALIES_VERBOSE = "0";
delete process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL;

let gameStore = null;
let completed = false;
try {
  const loader = require(path.join(modDir, "loader.js"));
  const authority = require(path.join(
    runtimeRoot,
    "server/src/services/dungeon/dungeonAuthority.js",
  ));
  authority.initializeDungeonAuthority();
  const authorityPayload = authority.getPayload();
  const installedOrePack = authorityPayload.meta.installedContentPacks.find(
    (entry) => entry.id === "evejs.ore-anomalies",
  );
  assert.deepStrictEqual(installedOrePack, {
    id: "evejs.ore-anomalies",
    version: "1.1.0",
    packSha256: "43bdf881ca141f166e2795b9aa45799d65c275376acb5030b1deb8cd41df324b",
    payloadSha256: "0f110a78980e47c629a9647a13ac4ec2ef5bac1c4cceaefae344f0140f955afc",
  });
  for (const sourceDungeonID of [5524, 5525, 5526, 5527, 5528, 5529]) {
    assert.strictEqual(
      authorityPayload.indexes.templateIDsBySourceDungeonID[String(sourceDungeonID)],
      `client-dungeon:${sourceDungeonID}`,
    );
  }

  const universe = require(path.join(
    runtimeRoot,
    "server/src/services/dungeon/dungeonUniverseRuntime.js",
  ));
  const dungeonRuntime = require(path.join(
    runtimeRoot,
    "server/src/services/dungeon/dungeonRuntime.js",
  ));
  const dungeonRuntimeState = require(path.join(
    runtimeRoot,
    "server/src/services/dungeon/dungeonRuntimeState.js",
  ));
  gameStore = require(path.join(runtimeRoot, "server/src/gameStore/index.js"));

  assert.strictEqual(
    loader.installation.active,
    true,
    `Moon loader rolled back during the real module graph: ${loader.installation.failure}`,
  );

  const systemID = 30004504;
  const nowMs = 1_789_000_000_000;
  const moonFamilies = authority.listUniverseSpawnFamilies()
    .filter((family) => family.startsWith("moon_"));
  assert.deepStrictEqual(
    moonFamilies.sort(),
    ["moon_r16", "moon_r32", "moon_r4", "moon_r64", "moon_r8"],
  );

  const planned = universe.listDesiredUniverseDungeonSiteDefinitions(
    [systemID],
    nowMs,
    { families: [...moonFamilies, "ore"] },
  );
  const plannedMoonDefinitions = planned.definitions.filter((definition) => (
    definition.siteFamily.startsWith("moon_")
  ));
  const plannedOfficialDefinitions = planned.definitions.filter((definition) => (
    definition.siteFamily === "ore"
  ));
  const expectedMoonNames = {
    moon_r4: "R4 Moon Ore Field",
    moon_r8: "R8 Moon Ore Field",
    moon_r16: "R16 Moon Ore Field",
    moon_r32: "R32 Moon Ore Field",
    moon_r64: "R64 Moon Ore Field",
  };
  assert.strictEqual(plannedMoonDefinitions.length, 4);
  assert.ok(plannedOfficialDefinitions.length > 0);
  assert.ok(plannedMoonDefinitions.every((definition) => (
    definition.sourceDungeonID == null &&
    definition.dungeonNameID == null
  )));

  const historicalDefinition = plannedMoonDefinitions[0];
  const historicalSourceDungeonID = ({
    moon_r4: 5524,
    moon_r8: 5525,
    moon_r16: 5526,
    moon_r32: 5528,
    moon_r64: 5529,
  })[historicalDefinition.siteFamily];
  const historicalDonorName = ({
    moon_r4: "Large Potent Asteroid Cluster",
    moon_r8: "Enormous Potent Asteroid Cluster",
    moon_r16: "Colossal Potent Asteroid Cluster",
    moon_r32: "Enormous Rich Asteroid Cluster",
    moon_r64: "Colossal Rich Asteroid Cluster",
  })[historicalDefinition.siteFamily];
  const historicalDungeonNameID = ({
    moon_r4: 289412,
    moon_r8: 289416,
    moon_r16: 289546,
    moon_r32: 289559,
    moon_r64: 289689,
  })[historicalDefinition.siteFamily];
  const historicalInstance = dungeonRuntime.createInstance(historicalDefinition);
  dungeonRuntimeState.mutateState((table) => {
    const row = table.instancesByID[String(historicalInstance.instanceID)];
    row.sourceDungeonID = historicalSourceDungeonID;
    row.dungeonNameID = historicalDungeonNameID;
    row.metadata.label = historicalDonorName;
    row.spawnState.label = historicalDonorName;
    row.metadata.definitionHash += ":0.12.7-policy-snapshot";
    return table;
  });

  const actualReconcile = dungeonRuntime.reconcileUniverseSeededInstances;
  const observedCalls = [];
  dungeonRuntime.reconcileUniverseSeededInstances = function observedReconcile(
    definitions,
    options,
  ) {
    const result = actualReconcile.call(this, definitions, options);
    observedCalls.push({
      definitions: JSON.parse(JSON.stringify(definitions)),
      options: JSON.parse(JSON.stringify(options)),
      result: JSON.parse(JSON.stringify(result)),
    });
    return result;
  };

  const ensured = universe.ensureSystemUniversePersistentSites(systemID, {
    includeMining: false,
    force: true,
    debounceMs: 0,
    nowMs,
  });
  dungeonRuntime.reconcileUniverseSeededInstances = actualReconcile;
  assert.strictEqual(ensured.success, true);

  const moonCall = observedCalls.find((entry) => (
    entry.definitions.filter((definition) => definition.siteFamily.startsWith("moon_")).length === 4
  ));
  assert.ok(moonCall, "real universe reconciliation did not receive four Moon definitions");
  assert.strictEqual(moonCall.result.retainedCount, 1);
  assert.strictEqual(moonCall.result.preservedCount, 1);
  assert.deepStrictEqual(moonCall.options.siteOriginFilter, ["universe_dungeon", "sov_hub"]);

  const activeMoonRows = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => instance.siteFamily.startsWith("moon_"));
  assert.strictEqual(activeMoonRows.length, 4);
  const retainedHistoricalRow = activeMoonRows.find((instance) => (
    instance.instanceID === historicalInstance.instanceID
  ));
  assert.strictEqual(retainedHistoricalRow.sourceDungeonID, historicalSourceDungeonID);
  assert.strictEqual(retainedHistoricalRow.dungeonNameID, null);
  assert.strictEqual(retainedHistoricalRow.metadata.label, expectedMoonNames[retainedHistoricalRow.siteFamily]);
  assert.ok(activeMoonRows.filter((instance) => instance.instanceID !== historicalInstance.instanceID)
    .every((instance) => instance.sourceDungeonID == null));
  const activeOfficialRows = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => instance.siteFamily === "ore");
  assert.ok(activeOfficialRows.length > 0);
  const populationHintsBeforeFlush = new Map(
    [...activeMoonRows, ...activeOfficialRows].map((instance) => [
      instance.siteKey,
      JSON.parse(JSON.stringify(instance.spawnState.populationHints)),
    ]),
  );

  const flush = gameStore.flushTableSync(dungeonRuntimeState.DUNGEON_RUNTIME_TABLE);
  assert.strictEqual(flush.success, true);
  const durable = gameStore.readPersisted(
    dungeonRuntimeState.DUNGEON_RUNTIME_TABLE,
    "/instancesByID",
  );
  assert.strictEqual(durable.success, true);
  const persistedMoonRows = Object.values(durable.data || {})
    .filter((instance) => instance.siteFamily.startsWith("moon_"));
  assert.strictEqual(persistedMoonRows.length, 4);
  const persistedHistoricalRow = persistedMoonRows.find((instance) => (
    instance.instanceID === historicalInstance.instanceID
  ));
  assert.strictEqual(persistedHistoricalRow.metadata.label, historicalDonorName);
  assert.strictEqual(persistedHistoricalRow.dungeonNameID, historicalDungeonNameID);
  const persistedOfficialRows = Object.values(durable.data || {})
    .filter((instance) => instance.siteFamily === "ore");
  assert.ok(persistedOfficialRows.length > 0);
  dungeonRuntimeState.clearRuntimeCache();
  const rehydratedMoonRows = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => instance.siteFamily.startsWith("moon_"));
  const rehydratedOfficialRows = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .filter((instance) => instance.siteFamily === "ore");
  assert.strictEqual(rehydratedMoonRows.length, 4);
  assert.ok(rehydratedMoonRows.every((instance) => (
    instance.metadata.label === expectedMoonNames[instance.siteFamily] &&
    instance.spawnState.label === expectedMoonNames[instance.siteFamily] &&
    instance.dungeonNameID == null
  )));
  for (const instance of [...rehydratedMoonRows, ...rehydratedOfficialRows]) {
    assert.deepStrictEqual(instance.spawnState.populationHints, populationHintsBeforeFlush.get(instance.siteKey));
  }
  assert.strictEqual(
    rehydratedMoonRows.find((instance) => instance.instanceID === historicalInstance.instanceID).sourceDungeonID,
    historicalSourceDungeonID,
  );

  dungeonRuntime.setLifecycleState(
    historicalInstance.instanceID,
    "despawned",
    { nowMs: nowMs + 1, reason: "source-less-upgrade-rotation-fixture" },
  );
  const replacement = dungeonRuntime.reconcileUniverseSeededInstances(
    [historicalDefinition],
    {
      systemIDs: [systemID],
      siteFamilyFilter: [historicalDefinition.siteFamily],
      siteOriginFilter: ["universe_dungeon"],
      nowMs: nowMs + 2,
    },
  );
  assert.strictEqual(replacement.replacedCount, 1);
  const sourceLessReplacement = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true })
    .find((instance) => instance.siteKey === historicalDefinition.siteKey);
  assert.ok(sourceLessReplacement.instanceID > historicalInstance.instanceID);
  assert.strictEqual(sourceLessReplacement.sourceDungeonID, null);

  const DungeonUniverseSiteService = require(path.join(
    runtimeRoot,
    "server/src/services/dungeon/dungeonUniverseSiteService.js",
  ));
  const scene = {
    systemID,
    staticEntities: [],
    dynamicEntities: new Map(),
    addStaticEntity(entity) {
      this.staticEntities.push(entity);
      return true;
    },
  };
  const materialized = DungeonUniverseSiteService.handleSceneCreated(scene, { nowMs });
  assert.strictEqual(materialized.success, true);

  const signatureRuntime = require(path.join(
    runtimeRoot,
    "server/src/services/exploration/signatures/signatureRuntime.js",
  ));
  const sigsMoonRows = signatureRuntime.buildSystemScannableViews(systemID, { scene })
    .filter((site) => site.family.startsWith("moon_"));
  assert.strictEqual(sigsMoonRows.length, 4);
  assert.ok(sigsMoonRows.every((site) => site.label === expectedMoonNames[site.family]));
  const moonSiteIDs = new Set(sigsMoonRows.map((site) => site.siteID));
  const emittedMoonRows = signatureRuntime.buildSignalTrackerAnomalyEntries(systemID, { scene })
    .filter(([siteID]) => moonSiteIDs.has(siteID));
  assert.strictEqual(emittedMoonRows.length, 4);
  assert.ok(emittedMoonRows.every(([, row]) => (
    row.args.entries.find(([key]) => key === "dungeonID")[1] === 0
  )));
  assert.ok(emittedMoonRows.every(([, row]) => (
    row.args.entries.find(([key]) => key === "dungeonNameID")[1] === null
  )));
  const sigsOfficialRows = signatureRuntime.buildSystemScannableViews(systemID, { scene })
    .filter((site) => site.family === "ore");
  assert.ok(sigsOfficialRows.length > 0);

  console.log(`PRODUCTION_PERSISTENCE_RESULT=${JSON.stringify({
    loaderActive: loader.installation.active,
    desiredDefinitions: planned.definitions.map((definition) => ({
      siteFamily: definition.siteFamily,
      siteID: definition.metadata.siteID,
      templateID: definition.templateID,
      siteOrigin: definition.siteOrigin,
      siteKey: definition.siteKey,
      definitionHash: definition.metadata.definitionHash,
      solarSystemID: definition.solarSystemID,
      lifecycleState: definition.lifecycleState,
    })),
    reconcileOptions: moonCall.options,
    reconcileResult: moonCall.result,
    persistedMoonCount: persistedMoonRows.length,
    persistedOfficialCount: persistedOfficialRows.length,
    rehydratedMoonCount: rehydratedMoonRows.length,
    sigsMoonCount: sigsMoonRows.length,
    sigsMoonNames: sigsMoonRows.map((site) => site.label).sort(),
    sigsMoonDungeonIDs: emittedMoonRows.map(([, row]) => (
      row.args.entries.find(([key]) => key === "dungeonID")[1]
    )),
    sigsOfficialCount: sigsOfficialRows.length,
    historicalSourceRetained: retainedHistoricalRow.sourceDungeonID === historicalSourceDungeonID,
    replacementSourceDungeonID: sourceLessReplacement.sourceDungeonID,
  })}`);
  completed = true;
} finally {
  if (gameStore) {
    try {
      gameStore.shutdown("moon-persistence-regression");
      gameStore._shutdownPersistenceWorkerForTests();
      gameStore._closeSqliteForTests();
    } catch (_) {
      // Cleanup must not hide the assertion that failed.
    }
  }
  try {
    fs.rmSync(temporaryStoreRoot, { recursive: true, force: true });
  } catch (_) {
    // Cleanup must not hide the assertion that failed.
  }
}

if (completed) process.exit(0);
