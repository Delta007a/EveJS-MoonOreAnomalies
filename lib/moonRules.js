"use strict";

/**
 * moonOreAnomalies — the rules file, loaded once and validated hard.
 *
 * Original design and the reference patch this reimplements are by Delta0070
 * (see CREDITS.md). The family/tier/composition data is his; the loading and
 * validation around it is this mod's, because a mod cannot rely on a file it
 * shipped into the vendor tree the way his patch could.
 *
 * Validation is strict and total, and that is deliberate. The failure this mod
 * exists to avoid is Delta0070's own reported one: a plan that looked valid all
 * the way through, produced siteID 0, and was then silently dropped by
 * reconcile with no error anywhere. A rules file that is wrong must say so at
 * load, naming the family and the field, rather than degrade into sites that
 * never appear.
 */

const fs = require("node:fs");
const path = require("node:path");

const BANDS = Object.freeze(["highsec", "lowsec", "nullsec", "wormhole"]);

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLower(value, fallback = "") {
  return String(value == null ? fallback : value).trim().toLowerCase();
}

/**
 * Validate one family. Returns an array of human-readable problems, empty when
 * the family is usable. Never throws — the caller decides whether a problem is
 * fatal to the whole mod or only to this family.
 */
function validateFamily(family, rule, siteIDBases) {
  const problems = [];
  const where = `families.${family}`;

  if (!/^moon_r\d+$/.test(family)) {
    problems.push(`${where}: family key must look like "moon_r4"`);
  }
  if (!rule || typeof rule !== "object") {
    problems.push(`${where}: not an object`);
    return problems;
  }
  if (!String(rule.templateID || "").trim()) {
    problems.push(`${where}.templateID: missing`);
  }
  if (!String(rule.tier || "").trim()) {
    problems.push(`${where}.tier: missing`);
  }

  const bands = Array.isArray(rule.securityBands) ? rule.securityBands.map((b) => normalizeLower(b)) : [];
  if (bands.length <= 0) {
    problems.push(`${where}.securityBands: empty — the family could never spawn`);
  }
  for (const band of bands) {
    if (!BANDS.includes(band)) problems.push(`${where}.securityBands: unknown band "${band}"`);
  }

  const rocks = Array.isArray(rule.miningRocks) ? rule.miningRocks : [];
  if (rocks.length <= 0) {
    problems.push(`${where}.miningRocks: empty — the site would contain nothing to mine`);
  }
  rocks.forEach((rock, index) => {
    const at = `${where}.miningRocks[${index}]`;
    if (toInt(rock && rock.typeID, 0) <= 0) problems.push(`${at}.typeID: must be a positive integer`);
    if (toInt(rock && rock.count, 0) <= 0) problems.push(`${at}.count: must be a positive integer`);
    if (toInt(rock && rock.quantity, 0) <= 0) problems.push(`${at}.quantity: must be a positive integer`);
  });

  // Density must cover exactly the bands the family claims. A band claimed but
  // undensified would silently never spawn (vendor treats a family present in
  // siteDensityRules but missing a band as "no sites in that band"); a band
  // densified but unclaimed is a contradiction the operator should see.
  const density = rule.density && typeof rule.density === "object" ? rule.density : {};
  for (const band of bands) {
    const entry = density[band];
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}.density.${band}: missing, but the band is listed in securityBands`);
      continue;
    }
    if (toInt(entry.slots, -1) < 0) problems.push(`${where}.density.${band}.slots: must be >= 0`);
    const p = Number(entry.p);
    if (!Number.isFinite(p) || p < 0 || p > 1) problems.push(`${where}.density.${band}.p: must be between 0 and 1`);
  }
  for (const band of Object.keys(density)) {
    if (!bands.includes(normalizeLower(band))) {
      problems.push(`${where}.density.${band}: densified but not listed in securityBands`);
    }
  }

  // The namespace check. This is the exact class of bug Delta0070 reported:
  // a family with no site-ID base plans correctly, builds siteID 0, and is then
  // dropped without a word. It is a load-time error here, not a mystery later.
  if (toInt(siteIDBases && siteIDBases[family], 0) <= 0) {
    problems.push(`${where}: no siteIDBases entry — every site would get siteID 0 and be silently skipped`);
  }

  return problems;
}

function validate(rules) {
  const problems = [];
  if (!rules || typeof rules !== "object") return ["rules file is not an object"];

  const families = rules.families && typeof rules.families === "object" ? rules.families : null;
  if (!families || Object.keys(families).length <= 0) return ["rules file declares no families"];

  const bases = rules.siteIDBases && typeof rules.siteIDBases === "object" ? rules.siteIDBases : {};

  for (const [family, rule] of Object.entries(families)) {
    problems.push(...validateFamily(normalizeLower(family), rule, bases));
  }

  // Two families sharing a donor template, or a site-ID base, would each
  // overwrite the other's sites. Both are cheap to detect and impossible to
  // debug from in-game symptoms.
  const seenTemplate = new Map();
  const seenBase = new Map();
  for (const [family, rule] of Object.entries(families)) {
    const templateID = String((rule && rule.templateID) || "").trim();
    if (templateID) {
      if (seenTemplate.has(templateID)) {
        problems.push(`families.${family}.templateID: "${templateID}" already used by ${seenTemplate.get(templateID)}`);
      }
      seenTemplate.set(templateID, family);
    }
    const base = toInt(bases[family], 0);
    if (base > 0) {
      if (seenBase.has(base)) {
        problems.push(`siteIDBases.${family}: base ${base} already used by ${seenBase.get(base)}`);
      }
      seenBase.set(base, family);
    }
  }

  return problems;
}

let cached = null;

/**
 * Load and validate the rules. Memoized: the whole mod shares one parsed copy,
 * and a rules file that failed validation stays failed for the process rather
 * than being retried on every hook.
 */
function load(modDir) {
  if (cached) return cached;

  const file = path.join(modDir, "data", "moonOreSiteRules.json");
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    cached = { ok: false, problems: [`cannot read ${file}: ${error && error.message}`], rules: null, file };
    return cached;
  }

  const problems = validate(parsed);
  cached = {
    ok: problems.length <= 0,
    problems,
    rules: problems.length <= 0 ? parsed : null,
    file,
  };
  return cached;
}

function reset() {
  cached = null;
}

module.exports = { BANDS, load, reset, toInt, normalizeLower, validate, validateFamily };
