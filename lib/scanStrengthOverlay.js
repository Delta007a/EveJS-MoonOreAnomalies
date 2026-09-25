"use strict";

/**
 * moonOreAnomalies — the exploration scan-strength overlay.
 *
 * ── The bug this fixes ───────────────────────────────────────────────
 * Giving moon sites their own `siteFamily` is what makes independent density
 * tuning possible, and it is what Delta0070's patch does. But `siteFamily` is
 * not only a spawn key: the exploration layer uses it to answer "what KIND of
 * scannable thing is this", and that lookup is a table of six literal names.
 *
 *   sceneAnomalySiteProvider.js:
 *     scanStrengthAttribute: toInt(
 *       entity && entity.signalTrackerStrengthAttributeID,
 *       explorationAuthority.getScanStrengthAttribute(family),   // "moon_r4" -> 0
 *     ) || null,
 *
 * `scanStrengthAttributes` holds exactly { data: 208, gas: 209, relic: 210,
 * ore: 211, combat: 1136, wormhole: 1908 }. A moon family misses, becomes 0,
 * and the `|| null` turns it into null on the wire. The client then does:
 *
 *   menuGroup = get_exploration_site_name_label(site_type=scanGroupID, ...)
 *   -> EXPLORATION_SITE_TYPES.get(None, None) -> None
 *   -> KeyError: None in _GetAnomaliesMenuGroup
 *
 * which takes out the whole right-click **Anomalies** submenu for the system —
 * not just the moon entries, but the vendor combat and ore sites listed beside
 * them, because one bad entry kills the menu being built.
 *
 * ── Why the fix is "ore" ─────────────────────────────────────────────
 * A moon anomaly IS an ore site as far as scanning is concerned: it is
 * gravimetric (attribute 211), it holds asteroids, and it is mined with mining
 * lasers. The moon families exist to separate *spawn density*, not to invent a
 * new scannable category — there is no client support for one, and inventing
 * one is what broke the menu. So every moon family answers this one question
 * exactly as `ore` does, and differs everywhere else.
 *
 * ── Divergence from Delta0070's patch ────────────────────────────────
 * This has no counterpart in his patch, and is not a repackaging artefact: his
 * patch sets the same `siteFamily` values and does not touch
 * explorationAuthority, so the same null reaches the same client code. It is a
 * latent bug in the original that a Probe Scanner test would not surface,
 * because the scanner renders sites individually while this menu groups them.
 * Recorded in CREDITS.md as a divergence rather than silently fixed.
 *
 * Only `getScanStrengthAttribute` is wrapped. The sibling lookup
 * `getSignatureTypeDefinition(family)` lives in sceneSignatureSiteProvider,
 * which moon sites never reach: `applyMoonOreSiteRule` forces
 * `siteKind: "anomaly"`, and the provider is chosen by site kind. Wrapping it
 * would be guarding a path that cannot execute.
 */

const ORE_FAMILY = "ore";

function normalizeLower(value, fallback = "") {
  return String(value == null ? fallback : value).trim().toLowerCase();
}

/**
 * Wrap `explorationAuthority.getScanStrengthAttribute` so every moon family
 * answers with the ore attribute.
 *
 * Returns `{ ok, problems }`. Failure leaves the module untouched.
 */
function install(explorationAuthority, rules, log) {
  const original = explorationAuthority && explorationAuthority.getScanStrengthAttribute;
  if (typeof original !== "function") {
    return { ok: false, problems: ["explorationAuthority.getScanStrengthAttribute is not a function"] };
  }

  const moonFamilies = new Set(
    Object.keys((rules && rules.families) || {}).map((family) => normalizeLower(family)),
  );
  if (moonFamilies.size <= 0) {
    return { ok: false, problems: ["no moon families to map"] };
  }

  // Resolved once, through the original, so this mod never hard-codes 211: if
  // the static table ever renumbers, moon sites follow ore automatically.
  const oreAttribute = original.call(explorationAuthority, ORE_FAMILY);
  if (!(oreAttribute > 0)) {
    return {
      ok: false,
      problems: [`the "${ORE_FAMILY}" scan strength attribute resolved to ${oreAttribute}; refusing to guess`],
    };
  }

  explorationAuthority.getScanStrengthAttribute = function getScanStrengthAttribute(name) {
    if (moonFamilies.has(normalizeLower(name))) {
      return oreAttribute;
    }
    return original.apply(this, arguments);
  };

  if (log) {
    log(`scan strength: ${moonFamilies.size} moon family(ies) -> ore attribute ${oreAttribute}`);
  }

  return { ok: true, problems: [], oreAttribute };
}

/** Cheap pre-filter for the loader's hook. */
function requestLooksLikeTarget(request) {
  return typeof request === "string" && request.includes("explorationAuthority");
}

module.exports = { ORE_FAMILY, install, requestLooksLikeTarget };
