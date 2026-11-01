"use strict";

const API_SYMBOL = "evejs.moonOreAnomalies";
const DENSITY_SYSTEM_HASH_STRIDE = 4_099;
const DENSITY_SLOT_HASH_STRIDE = 131;
const DENSITY_HASH_UNIT_DIVISOR = 0x1_0000_0000;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function hashValue(value) {
  let state = toInt(value, 0) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function hashText(value) {
  const normalized = String(value == null ? "" : value).trim();
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = hashValue(state + normalized.charCodeAt(index));
  }
  return state >>> 0;
}

function createRuntimeApi({ enabled, rules, version, templateIDs = {}, settings = {} }) {
  const families = new Set(Object.keys(rules.families || {}).map((value) => value.toLowerCase()));
  let retirementStatus = Object.freeze({ attempted: false, success: false, mode: enabled ? "enabled" : "disabled" });
  const chanceMultiplier = settings.spawnChanceMultiplier ?? 1;
  const perSystemLimit = settings.maxSitesPerSystem ?? 0;
  const respawnDelayMs = Math.round((settings.respawnDelayMinutes ?? 0) * 60_000);
  return Object.freeze({
    enabled: enabled === true,
    version: String(version),
    isMoonFamily(family) {
      return families.has(String(family || "").trim().toLowerCase());
    },
    isOwnedMinedOutSite(instance) {
      if (enabled !== true || !instance) return false;
      const family = String(instance.siteFamily || "").trim().toLowerCase();
      const spawnFamily = String(instance.metadata?.spawnFamilyKey ||
        instance.spawnState?.spawnFamilyKey || family).trim().toLowerCase();
      return families.has(family) && spawnFamily === family &&
        Boolean(templateIDs[family]) && String(instance.templateID || "") === templateIDs[family] &&
        String(instance.siteOrigin || "").trim().toLowerCase() === "universe_dungeon" &&
        instance.runtimeFlags?.universeSeeded === true &&
        instance.runtimeFlags?.universePersistent === true;
    },
    getMinedOutRespawnDelayMs(instance) {
      return this.isOwnedMinedOutSite(instance) ? respawnDelayMs : null;
    },
    isOwnedDelayedRespawn(instance) {
      return this.isOwnedMinedOutSite(instance) &&
        instance.lifecycleState === "completed" && instance.lifecycleReason === "depleted";
    },
    getSlotCeiling(family) {
      const rule = rules.families[String(family || "").trim().toLowerCase()];
      if (!rule) return 0;
      return Math.max(0, ...Object.values(rule.density || {}).map((entry) => toInt(entry && entry.slots, 0)));
    },
    getProbability(family, band) {
      const rule = rules.families[String(family || "").trim().toLowerCase()];
      const entry = rule && rule.density && rule.density[String(band || "").trim().toLowerCase()];
      const value = Number(entry && entry.p);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value * chanceMultiplier)) : 0;
    },
    slotSpawnsInSystem(systemID, family, band, slotIndex = 0, readInstances = () => []) {
      const normalizedFamily = String(family || "").trim().toLowerCase();
      if (!families.has(normalizedFamily)) return false;
      const instances = readInstances().filter(row => this.isOwnedMinedOutSite(row));
      const active = new Set(instances.filter(row => ["seeded", "active", "paused"].includes(row.lifecycleState)).map(row => row.siteFamily));
      // Existing work is grandfathered. Lowering density/cap must not delete
      // rocks already being mined; completed slots use the new policy.
      if (active.has(normalizedFamily)) return true;
      const accepts = candidate => {
        const probability = this.getProbability(candidate, band);
        const roll = hashValue(hashValue((toInt(systemID, 0) * DENSITY_SYSTEM_HASH_STRIDE) +
          (toInt(slotIndex, 0) * DENSITY_SLOT_HASH_STRIDE)) + hashText(`density:${candidate}`));
        return (roll / DENSITY_HASH_UNIT_DIVISOR) < probability;
      };
      if (!accepts(normalizedFamily)) return false;
      if (perSystemLimit <= 0) return true;
      // A completed slot reserves its seat until the owner rotates/retires it,
      // so another family cannot bypass a durable respawn cooldown.
      const reserved = new Set(instances.filter(row => this.isOwnedDelayedRespawn(row) && row.siteFamily !== normalizedFamily).map(row => row.siteFamily));
      const occupied = new Set([...active, ...reserved]);
      const available = Math.max(0, perSystemLimit - occupied.size);
      const eligible = [...families].filter(candidate => !occupied.has(candidate) && accepts(candidate))
        .sort((a,b) => hashText(`cap:${systemID}:${a}`) - hashText(`cap:${systemID}:${b}`) || a.localeCompare(b));
      return eligible.slice(0, available).includes(normalizedFamily);
    },
    setRetirementStatus(status) {
      retirementStatus = Object.freeze({ ...status });
      return retirementStatus;
    },
    getRetirementStatus() {
      return { ...retirementStatus };
    },
    listFamilies() {
      return [...families];
    },
  });
}

module.exports = {
  API_SYMBOL,
  DENSITY_HASH_UNIT_DIVISOR,
  DENSITY_SLOT_HASH_STRIDE,
  DENSITY_SYSTEM_HASH_STRIDE,
  createRuntimeApi,
  hashText,
  hashValue,
};
