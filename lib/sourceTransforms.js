"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const API_SYMBOL = "evejs.moonOreAnomalies";
const TARGET = "server/src/services/dungeon/dungeonUniverseRuntime.js";
const MARKER = "/* moonOreAnomalies:0.12.9-beta-native */";
const MARKER_PATTERN = /\/\*\s*moonOreAnomalies:[^*]*\*\//gu;
const ID_ANCHOR = "const UNIVERSE_SITE_ID_BASES = Object.freeze({";
const COUNT_ANCHOR = "  const normalizedFamily = normalizeLowerText(family, \"\");\n  const countsByFamily = config.universeSiteCountsByFamily &&";
const PROBABILITY_ANCHOR = "    const matcher = entry.matchersByBand.get(band);\n    if (matcher && !matcher(numericSystemID)) {\n      continue;\n    }\n    if (\n      entry.selectionAuthority === STRICT_SECURITY_ORE_SELECTION_AUTHORITY &&";

function countText(source, token) {
  return String(source).split(token).length - 1;
}

function anchorVariants(token) {
  const variants = [String(token)];
  if (String(token).includes("\n")) variants.push(String(token).replaceAll("\n", "\r\n"));
  return [...new Set(variants)];
}

function findUniqueAnchor(source, token, label) {
  const text = String(source);
  const matches = [];
  for (const variant of anchorVariants(token)) {
    let offset = 0;
    while (offset <= text.length) {
      const index = text.indexOf(variant, offset);
      if (index < 0) break;
      const nextLf = text.indexOf("\n", index + variant.length);
      const eol = variant.includes("\r\n") || (nextLf > 0 && text[nextLf - 1] === "\r")
        ? "\r\n"
        : "\n";
      matches.push({ index, token: variant, eol });
      offset = index + Math.max(1, variant.length);
    }
  }
  matches.sort((left, right) => left.index - right.index);
  if (matches.length !== 1) throw new Error(`${label}: anchor count ${matches.length}, expected 1`);
  return matches[0];
}

function replaceExactlyOnce(source, token, buildReplacement, label) {
  const text = String(source);
  const match = findUniqueAnchor(text, token, label);
  const replacement = typeof buildReplacement === "function"
    ? buildReplacement(match)
    : String(buildReplacement);
  return text.slice(0, match.index) + replacement + text.slice(match.index + match.token.length);
}

function buildBaseInjection(siteIDBases, eol = "\n") {
  return Object.entries(siteIDBases).map(([family, base]) => `${eol}  ${family}: ${Number(base)},`).join("");
}

function transformUniverseRuntime(source, siteIDBases) {
  let result = String(source);
  const markers = result.match(MARKER_PATTERN) || [];
  if (markers.includes(MARKER)) throw new Error("MOON_TRANSFORM_ALREADY_APPLIED");
  if (markers.length > 0) throw new Error(`MOON_TRANSFORM_CONFLICTING_MARKER:${markers.join(",")}`);
  for (const family of Object.keys(siteIDBases)) {
    if (new RegExp(`\\b${family}\\s*:`).test(result)) {
      throw new Error(`MOON_SITE_ID_ALREADY_PRESENT:${family}`);
    }
  }
  result = replaceExactlyOnce(
    result,
    ID_ANCHOR,
    ({ token, eol }) => `${token}${buildBaseInjection(siteIDBases, eol)}${eol}  ${MARKER}`,
    "moon site-ID table",
  );
  result = replaceExactlyOnce(
    result,
    COUNT_ANCHOR,
    ({ eol }) => [
      "  const normalizedFamily = normalizeLowerText(family, \"\");",
      `  const moonOreApi = globalThis[Symbol.for("${API_SYMBOL}")];`,
      "  if (normalizedFamily.startsWith(\"moon_\")) {",
      "    return moonOreApi && moonOreApi.enabled === true && moonOreApi.isMoonFamily(normalizedFamily)",
      "      ? moonOreApi.getSlotCeiling(normalizedFamily)",
      "      : 0;",
      "  }",
      "  const countsByFamily = config.universeSiteCountsByFamily &&",
    ].join(eol),
    "moon fixed-count guard",
  );
  result = replaceExactlyOnce(
    result,
    PROBABILITY_ANCHOR,
    ({ eol }) => [
      "    const matcher = entry.matchersByBand.get(band);",
      "    if (matcher && !matcher(numericSystemID)) {",
      "      continue;",
      "    }",
      `    const moonOrePlanApi = globalThis[Symbol.for("${API_SYMBOL}")];`,
      "    if (entry.family.startsWith(\"moon_\") && (",
      "      !moonOrePlanApi ||",
      "      moonOrePlanApi.enabled !== true ||",
      "      !moonOrePlanApi.isMoonFamily(entry.family) ||",
      "      !moonOrePlanApi.slotSpawnsInSystem(numericSystemID, entry.family, band, 0)",
      "    )) {",
      "      continue;",
      "    }",
      "    if (",
      "      entry.selectionAuthority === STRICT_SECURITY_ORE_SELECTION_AUTHORITY &&",
    ].join(eol),
    "moon probability adapter",
  );
  if (countText(result, MARKER) !== 1) throw new Error("MOON_TRANSFORM_MARKER_INSTALL_FAILED");
  for (const family of Object.keys(siteIDBases)) {
    const declarations = result.match(new RegExp(`\\b${family}\\s*:`, "gu")) || [];
    if (declarations.length !== 1) throw new Error(`MOON_SITE_ID_INSTALL_FAILED:${family}:${declarations.length}`);
  }
  return result;
}

function inspectUniverseRuntime(source, siteIDBases) {
  try {
    const transformed = transformUniverseRuntime(source, siteIDBases);
    // Parse without executing any vendor dependency.
    new Function("require", "module", "exports", "__filename", "__dirname", transformed);
    return { ok: true, source: transformed };
  } catch (error) {
    return { ok: false, reason: error.message, error };
  }
}

function loadTransformed(filename, parent, siteIDBases, source = null) {
  if (Module._cache[filename]) throw new Error(`MOON_TRANSFORM_TARGET_CACHED:${filename}`);
  const transformed = transformUniverseRuntime(source == null ? fs.readFileSync(filename, "utf8") : source, siteIDBases);
  const instance = new Module(filename, parent);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  Module._cache[filename] = instance;
  try {
    instance._compile(transformed, filename);
    instance.loaded = true;
    return instance.exports;
  } catch (error) {
    delete Module._cache[filename];
    throw error;
  }
}

module.exports = {
  API_SYMBOL,
  MARKER_PATTERN,
  COUNT_ANCHOR,
  ID_ANCHOR,
  MARKER,
  PROBABILITY_ANCHOR,
  TARGET,
  anchorVariants,
  findUniqueAnchor,
  inspectUniverseRuntime,
  loadTransformed,
  transformUniverseRuntime,
};
