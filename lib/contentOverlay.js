"use strict";

const OVERLAY_MARKER = Symbol.for("evejs.moonOreAnomalies.contentOverlay");
const POCHVEN_REGION_ID = 10000070;
const REVIEWED_OFFICIAL_ORE_PACK = Object.freeze({
  id: "evejs.ore-anomalies",
  version: "1.1.0",
  packSha256: "43bdf881ca141f166e2795b9aa45799d65c275376acb5030b1deb8cd41df324b",
  payloadSha256: "0f110a78980e47c629a9647a13ac4ec2ef5bac1c4cceaefae344f0140f955afc",
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function conflict(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function validateOfficialOrePack(payload) {
  const installed = payload && payload.meta && Array.isArray(payload.meta.installedContentPacks)
    ? payload.meta.installedContentPacks
    : [];
  const matches = installed.filter((entry) => entry && entry.id === REVIEWED_OFFICIAL_ORE_PACK.id);
  if (matches.length === 0) return Object.freeze({ present: false });
  if (matches.length !== 1) {
    throw conflict("MOON_OFFICIAL_ORE_PACK_MISMATCH", "official ore pack identity is duplicated");
  }
  const actual = matches[0];
  for (const key of ["version", "packSha256", "payloadSha256"]) {
    if (String(actual[key] || "").trim().toLowerCase() !== REVIEWED_OFFICIAL_ORE_PACK[key].toLowerCase()) {
      throw conflict(
        "MOON_OFFICIAL_ORE_PACK_MISMATCH",
        `${REVIEWED_OFFICIAL_ORE_PACK.id} ${key}=${actual[key]}, expected ${REVIEWED_OFFICIAL_ORE_PACK[key]}`,
        { key, expected: REVIEWED_OFFICIAL_ORE_PACK[key], actual: actual[key] },
      );
    }
  }
  return Object.freeze({ present: true, identity: clone(actual) });
}

function buildTemplate(family, rule, snapshot, common, modVersion, contentRevision = modVersion) {
  const resourceTypeIDs = rule.miningRocks.map((rock) => Number(rock.typeID));
  const objectiveMarkers = clone(common.objectiveMarkers || []);
  const miningRocks = rule.miningRocks.map((rock) => ({
    typeID: Number(rock.typeID),
    oreTypeID: Number(rock.typeID),
    kind: "ore",
    label: String(rock.ore),
    count: Number(rock.count),
    quantity: Number(rock.quantity),
    source: "moonOreSiteRules",
  }));
  return {
    templateID: snapshot.templateID,
    source: "moonOreAnomalies",
    sourcePriority: Number(common.sourcePriority || 100),
    sourceConfidence: clone(common.sourceConfidence),
    siteFamily: family,
    siteKind: "anomaly",
    siteOrigin: "client_dungeon",
    resolvedName: snapshot.resolvedName,
    archetypeID: Number(snapshot.archetypeID),
    // A historical localization ID would make the client show the donor name.
    // Source-less Moon sites instead use their runtime entity presentation label.
    dungeonNameID: null,
    descriptionID: null,
    factionID: Number(snapshot.factionID),
    difficulty: Number(snapshot.difficulty),
    entryObjectTypeID: Number(snapshot.entryObjectTypeID),
    missionBriefingID: null,
    objectivesID: null,
    useDefaultSpaceMusic: false,
    connections: {},
    archetype: clone(common.archetype),
    clientObjectives: null,
    objectiveMetadata: null,
    environmentTemplates: null,
    resourceComposition: {
      oreTypeIDs: resourceTypeIDs,
      gasTypeIDs: [],
      iceTypeIDs: [],
      hasAnyResources: true,
    },
    populationHints: {
      source: "moonOreSiteRules",
      siteFamily: family,
      siteKind: "anomaly",
      resourceYieldKind: "ore",
      encounter: null,
      encounters: [],
      containers: [],
      hazards: [],
      environmentProps: [],
      lootProfiles: [],
      resources: { oreTypeIDs: resourceTypeIDs, gasTypeIDs: [], iceTypeIDs: [] },
      dangerousWarpIn: false,
      safeFromNpc: true,
      objectiveMarkers,
      miningRocks,
      nativeMod: { id: "moonOreAnomalies", version: String(contentRevision), templateSchema: 1 },
    },
    siteSceneProfile: {
      source: "moon_ore_anomalies_mod_snapshot",
      confidence: clone(common.sourceConfidence),
      evidence: ["verified_client_identity", "moonOreSiteRules"],
      roomProfiles: [{ roomKey: "room:entry", label: "Entry Pocket", source: "mod_snapshot", objectiveKeys: [] }],
      gateProfiles: [],
      structureProfiles: [],
      objectiveVisualProfiles: objectiveMarkers,
    },
    resourceHints: {
      oreTypesByDungeonIDAvailable: true,
      gasTypesByDungeonIDAvailable: true,
      iceTypesByDungeonIDAvailable: true,
    },
    securityBands: [...rule.securityBands],
    spawnDisabled: false,
    prospectingArray: null,
    prospectingArrayTier: null,
    requiresSovereignty: false,
    wormholeClassIDs: [],
    requiresShatteredSystem: false,
    requiresLowsecBorder: false,
    requiresRegionIDs: [],
    requiresSystemIDs: [],
    requiresSunTypeIDs: [],
    securityBandSource: "moonOreSiteRules",
    securityBandRuleSiteKind: true,
    privateMoonOreAnomaly: true,
    moonOreTier: rule.tier,
    _moonOreAnomalies: { id: "moonOreAnomalies", version: String(modVersion), owned: true },
  };
}

function buildProfile(family, rule, modVersion) {
  return {
    enabled: true,
    bands: [...rule.securityBands],
    siteLifetimeMinutes: Number(rule.siteLifetimeMinutes),
    siteOrigin: "universe_dungeon",
    excludeRegionIDs: [POCHVEN_REGION_ID],
    bandTuning: Object.fromEntries(rule.securityBands.map((band) => [band, { difficultyRange: [0, 99] }])),
    templateFilters: {
      siteFamilies: [family],
      siteKinds: ["anomaly"],
      nameIncludesAny: [],
      nameExcludesAny: [],
    },
    moonOreAnomalies: { version: String(modVersion), probabilityByBand: clone(rule.density) },
  };
}

function apply(payload, rules, snapshots, options = {}) {
  if (!payload || typeof payload !== "object") throw conflict("MOON_AUTHORITY_PAYLOAD_INVALID", "payload is not an object");
  if (!snapshots || snapshots.schema !== "evejs.mod.moon-ore-templates.v1") {
    throw conflict("MOON_TEMPLATE_SNAPSHOT_INVALID", "unsupported template snapshot schema");
  }
  // Security mission bindings carry receipts trusted by object identity.
  // Keep native template records intact until EveJS rebuilds the catalogue.
  const result = {
    ...payload,
    templatesByID: { ...payload.templatesByID },
    spawnProfiles: {
      ...payload.spawnProfiles,
      families: { ...payload.spawnProfiles?.families },
    },
  };
  validateOfficialOrePack(result);
  const addedTemplateIDs = [];
  for (const [family, rule] of Object.entries(rules.families || {})) {
    const snapshot = snapshots.templatesByFamily && snapshots.templatesByFamily[family];
    if (!snapshot) throw conflict("MOON_TEMPLATE_SNAPSHOT_MISSING", `missing snapshot for ${family}`);
    if (Object.prototype.hasOwnProperty.call(result.templatesByID, snapshot.templateID)) {
      throw conflict("MOON_TEMPLATE_ID_CONFLICT", `${snapshot.templateID} is already owned by authority content`);
    }
    const profileOwner = Object.keys(result.spawnProfiles.families)
      .find((key) => key.trim().toLowerCase() === family.toLowerCase());
    if (profileOwner !== undefined) {
      throw conflict("MOON_SPAWN_PROFILE_CONFLICT", `${family} spawn profile is already present as ${profileOwner}`);
    }
    result.templatesByID[snapshot.templateID] = buildTemplate(
      family,
      rule,
      snapshot,
      snapshots.common || {},
      options.modVersion || "unknown",
      options.contentRevision || options.modVersion || "unknown",
    );
    result.spawnProfiles.families[family] = buildProfile(family, rule, options.modVersion || "unknown");
    addedTemplateIDs.push(snapshot.templateID);
  }
  result.meta = {
    ...(result.meta || {}),
    nativeMods: {
      ...((result.meta && result.meta.nativeMods) || {}),
      moonOreAnomalies: { version: String(options.modVersion || "unknown"), templateIDs: [...addedTemplateIDs] },
    },
  };
  const rebuild = options.rebuildDungeonDerivedFields;
  if (typeof rebuild !== "function") {
    throw conflict("MOON_AUTHORITY_REBUILD_MISSING", "contentPackManager.rebuildDungeonDerivedFields is unavailable");
  }
  return rebuild(result);
}

function install(manager, context) {
  if (!manager || typeof manager.applyDungeonContentPacks !== "function" ||
      typeof manager.rebuildDungeonDerivedFields !== "function") {
    throw conflict("MOON_CONTENT_MANAGER_SHAPE", "required content-pack exports are unavailable");
  }
  if (manager[OVERLAY_MARKER]) throw conflict("MOON_CONTENT_OVERLAY_DUPLICATE", "content overlay already installed");
  const original = manager.applyDungeonContentPacks;
  function applyDungeonContentPacksWithMoon(basePayload, loadedPacks) {
    try {
      const payload = original.call(this, basePayload, loadedPacks);
      return apply(payload, context.rules, context.snapshots, {
        modVersion: context.modVersion,
        contentRevision: context.contentRevision,
        rebuildDungeonDerivedFields: manager.rebuildDungeonDerivedFields,
      });
    } catch (error) {
      if (typeof context.onFailure === "function") context.onFailure(error);
      throw error;
    }
  }
  manager.applyDungeonContentPacks = applyDungeonContentPacksWithMoon;
  Object.defineProperty(manager, OVERLAY_MARKER, { value: true, configurable: true });
  return {
    restore() {
      if (manager.applyDungeonContentPacks === applyDungeonContentPacksWithMoon) {
        manager.applyDungeonContentPacks = original;
      }
      delete manager[OVERLAY_MARKER];
    },
  };
}

module.exports = {
  OVERLAY_MARKER,
  POCHVEN_REGION_ID,
  REVIEWED_OFFICIAL_ORE_PACK,
  apply,
  buildProfile,
  buildTemplate,
  install,
  validateOfficialOrePack,
};
