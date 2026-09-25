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

function createRuntimeApi({ enabled, rules, version }) {
  const families = new Set(Object.keys(rules.families || {}).map((value) => value.toLowerCase()));
  let retirementStatus = Object.freeze({ attempted: false, success: false, mode: enabled ? "enabled" : "disabled" });
  return Object.freeze({
    enabled: enabled === true,
    version: String(version),
    isMoonFamily(family) {
      return families.has(String(family || "").trim().toLowerCase());
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
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    },
    slotSpawnsInSystem(systemID, family, band, slotIndex = 0) {
      const normalizedFamily = String(family || "").trim().toLowerCase();
      if (!families.has(normalizedFamily)) return false;
      const probability = this.getProbability(normalizedFamily, band);
      if (probability >= 1) return true;
      if (probability <= 0) return false;
      const salt = hashText(`density:${normalizedFamily}`);
      const roll = hashValue(
        hashValue((toInt(systemID, 0) * DENSITY_SYSTEM_HASH_STRIDE) +
          (toInt(slotIndex, 0) * DENSITY_SLOT_HASH_STRIDE)) + salt,
      );
      return (roll / DENSITY_HASH_UNIT_DIVISOR) < probability;
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
