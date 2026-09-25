"use strict";

const path = require("node:path");

const OVERLAY_MARKER = Symbol.for("evejs.moonOreAnomalies.lifecycleOverlay");
const RETENTION_OVERLAY_MARKER = Symbol.for("evejs.moonOreAnomalies.upgradeRetentionOverlay");
const HISTORICAL_SOURCE_DUNGEON_IDS = Object.freeze({
  moon_r4: 5524,
  moon_r8: 5525,
  moon_r16: 5526,
  moon_r32: 5528,
  moon_r64: 5529,
});
const ACTIVE_LIFECYCLE_STATES = new Set(["seeded", "active", "paused"]);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function spawnFamilyOf(instance) {
  return String(
    instance && instance.metadata && instance.metadata.spawnFamilyKey ||
    instance && instance.spawnState && instance.spawnState.spawnFamilyKey ||
    instance && instance.siteFamily || "",
  ).trim().toLowerCase();
}

function slotIndexOf(instance) {
  return Math.max(0, toInt(
    instance && instance.metadata && instance.metadata.slotIndex,
    toInt(instance && instance.spawnState && instance.spawnState.slotIndex, 0),
  ));
}

function hasReservedSiteID(instance, family, siteIDBases) {
  const base = Number(siteIDBases[family]);
  const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
  const siteID = Math.max(0, toInt(
    instance && instance.metadata && instance.metadata.siteID,
    toInt(instance && instance.spawnState && instance.spawnState.siteID, 0),
  ));
  if (!base || !systemID || !siteID) return false;
  const offset = siteID - base - (systemID * 1000) - 1;
  return offset >= 0 && offset < 1000;
}

function isModOwnedInstance(instance, family, siteIDBases, templateIDs) {
  if (!instance || String(instance.siteOrigin || "").trim().toLowerCase() !== "universe_dungeon") return false;
  if (String(instance.siteFamily || "").trim().toLowerCase() !== family) return false;
  const templateID = String(instance.templateID || "").trim();
  const historicalTemplateID = `client-dungeon:${HISTORICAL_SOURCE_DUNGEON_IDS[family]}`;
  return templateID === templateIDs[family] ||
    templateID === historicalTemplateID ||
    templateID.startsWith("evejs-mod:moon-ore:") ||
    hasReservedSiteID(instance, family, siteIDBases);
}

function collectUpgradeRetentionSiteKeys(runtime, definitions, context) {
  if (!context.enabled) return [];
  const desiredBySiteKey = new Map(
    (Array.isArray(definitions) ? definitions : [])
      .filter((definition) => definition && definition.siteKey)
      .map((definition) => [String(definition.siteKey), definition]),
  );
  if (desiredBySiteKey.size === 0) return [];
  const retained = [];
  for (const family of Object.keys(context.rules.families || {})) {
    const historicalSourceDungeonID = HISTORICAL_SOURCE_DUNGEON_IDS[family];
    for (const instance of runtime.listInstancesByFamily(family, { full: true })) {
      const desired = desiredBySiteKey.get(String(instance && instance.siteKey || ""));
      if (
        desired &&
        ACTIVE_LIFECYCLE_STATES.has(String(instance.lifecycleState || "").trim().toLowerCase()) &&
        toInt(instance.sourceDungeonID, 0) === historicalSourceDungeonID &&
        isCurrentInstance(instance, family, context.rules.siteIDBases, context.templateIDs) &&
        String(desired.templateID || "") === context.templateIDs[family] &&
        String(desired.siteFamily || "").trim().toLowerCase() === family
      ) {
        retained.push(instance.siteKey);
      }
    }
  }
  return [...new Set(retained)];
}

function installUpgradeRetention(runtime, context) {
  if (!runtime || typeof runtime.reconcileUniverseSeededInstances !== "function" ||
      typeof runtime.listInstancesByFamily !== "function") {
    throw new Error("MOON_DUNGEON_RUNTIME_SHAPE_INVALID");
  }
  if (runtime[RETENTION_OVERLAY_MARKER]) {
    throw new Error("MOON_UPGRADE_RETENTION_OVERLAY_DUPLICATE");
  }
  const original = runtime.reconcileUniverseSeededInstances;
  function reconcileUniverseSeededInstancesWithMoonRetention(definitions, options = {}) {
    const transitionKeys = collectUpgradeRetentionSiteKeys(runtime, definitions, context);
    if (transitionKeys.length === 0) {
      return original.call(this, definitions, options);
    }
    return original.call(this, definitions, {
      ...options,
      preserveSiteKeys: [...new Set([
        ...(Array.isArray(options.preserveSiteKeys) ? options.preserveSiteKeys : []),
        ...transitionKeys,
      ])],
    });
  }
  runtime.reconcileUniverseSeededInstances = reconcileUniverseSeededInstancesWithMoonRetention;
  Object.defineProperty(runtime, RETENTION_OVERLAY_MARKER, { value: true, configurable: true });
  return {
    restore() {
      if (runtime.reconcileUniverseSeededInstances === reconcileUniverseSeededInstancesWithMoonRetention) {
        runtime.reconcileUniverseSeededInstances = original;
      }
      delete runtime[RETENTION_OVERLAY_MARKER];
    },
  };
}

function isCurrentInstance(instance, family, siteIDBases, templateIDs) {
  return isModOwnedInstance(instance, family, siteIDBases, templateIDs) &&
    String(instance.templateID || "") === templateIDs[family] &&
    spawnFamilyOf(instance) === family &&
    hasReservedSiteID(instance, family, siteIDBases) &&
    Boolean(instance.runtimeFlags && instance.runtimeFlags.universeSeeded === true &&
      instance.runtimeFlags.universePersistent === true);
}

function collect(runtime, context) {
  const preserveSiteKeys = [];
  const owned = [];
  const obsolete = [];
  for (const family of Object.keys(context.rules.families || {})) {
    for (const instance of runtime.listInstancesByFamily(family, { full: true })) {
      if (String(instance && instance.siteOrigin || "").trim().toLowerCase() !== "universe_dungeon") continue;
      const ownedInstance = isModOwnedInstance(instance, family, context.rules.siteIDBases, context.templateIDs);
      const current = ownedInstance && isCurrentInstance(instance, family, context.rules.siteIDBases, context.templateIDs);
      if (ownedInstance) owned.push(instance);
      if (ownedInstance && (!context.enabled || !current)) obsolete.push(instance);
      if ((!ownedInstance || (context.enabled && current)) && instance.siteKey) preserveSiteKeys.push(instance.siteKey);
    }
  }
  return { owned, obsolete, preserveSiteKeys: [...new Set(preserveSiteKeys)] };
}

function retire(runtime, context) {
  if (!runtime || typeof runtime.listInstancesByFamily !== "function" ||
      typeof runtime.reconcileUniverseSeededInstances !== "function") {
    throw new Error("MOON_DUNGEON_RUNTIME_SHAPE_INVALID");
  }
  const before = collect(runtime, context);
  const result = runtime.reconcileUniverseSeededInstances([], {
    nowMs: Date.now(),
    siteFamilyFilter: Object.keys(context.rules.families || {}),
    siteOriginFilter: ["universe_dungeon"],
    preserveSiteKeys: before.preserveSiteKeys,
  });
  const after = collect(runtime, context);
  if (after.obsolete.length > 0 || (!context.enabled && after.owned.length > 0)) {
    throw new Error(`MOON_RETIREMENT_INCOMPLETE:${after.obsolete.length}:${after.owned.length}`);
  }
  return Object.freeze({
    attempted: true,
    success: true,
    mode: context.enabled ? "enabled-legacy-retirement" : "disabled-full-retirement",
    ownedBefore: before.owned.length,
    obsoleteBefore: before.obsolete.length,
    removed: Math.max(0, toInt(result && result.removedCount, 0) + toInt(result && result.replacedCount, 0)),
    preserved: before.preserveSiteKeys.length,
    ownedAfter: after.owned.length,
    obsoleteAfter: after.obsolete.length,
  });
}

function install(globalSiteRuntime, context) {
  if (!globalSiteRuntime || typeof globalSiteRuntime.bindDurableScheduler !== "function") {
    throw new Error("MOON_GLOBAL_SITE_SCHEDULER_SHAPE_INVALID");
  }
  if (globalSiteRuntime[OVERLAY_MARKER]) throw new Error("MOON_LIFECYCLE_OVERLAY_DUPLICATE");
  const original = globalSiteRuntime.bindDurableScheduler;
  let completed = false;
  function bindDurableSchedulerAfterMoonRetirement(scheduler) {
    if (!completed) {
      try {
        const runtime = context.dungeonRuntime || require(path.join(context.runtimeRoot, "server/src/services/dungeon/dungeonRuntime"));
        const report = retire(runtime, context);
        context.api.setRetirementStatus(report);
        context.log(
          `retirement success mode=${report.mode} removed=${report.removed} preserved=${report.preserved} remaining=${report.ownedAfter}`,
        );
        completed = true;
      } catch (error) {
        context.api.setRetirementStatus({ attempted: true, success: false, mode: context.enabled ? "enabled" : "disabled", error: error.message });
        if (typeof context.onFailure === "function") context.onFailure(error);
        throw error;
      }
    }
    return original.call(this, scheduler);
  }
  globalSiteRuntime.bindDurableScheduler = bindDurableSchedulerAfterMoonRetirement;
  Object.defineProperty(globalSiteRuntime, OVERLAY_MARKER, { value: true, configurable: true });
  return {
    restore() {
      if (globalSiteRuntime.bindDurableScheduler === bindDurableSchedulerAfterMoonRetirement) {
        globalSiteRuntime.bindDurableScheduler = original;
      }
      delete globalSiteRuntime[OVERLAY_MARKER];
    },
  };
}

module.exports = {
  HISTORICAL_SOURCE_DUNGEON_IDS,
  OVERLAY_MARKER,
  RETENTION_OVERLAY_MARKER,
  collect,
  collectUpgradeRetentionSiteKeys,
  hasReservedSiteID,
  install,
  installUpgradeRetention,
  isCurrentInstance,
  isModOwnedInstance,
  retire,
  slotIndexOf,
  spawnFamilyOf,
};
