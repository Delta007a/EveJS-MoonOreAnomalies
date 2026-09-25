"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.resolve(modRoot, "../..");
const cleanRoot = path.resolve(process.argv[2] || runtimeRoot);
process.env.EVEJS_MOON_ORE_ANOMALIES_TEST_NO_AUTOINSTALL = "1";
const loader = require(path.join(modRoot, "loader"));
const contentOverlay = require(path.join(modRoot, "lib/contentOverlay"));
const transforms = require(path.join(modRoot, "lib/sourceTransforms"));
const rules = require(path.join(modRoot, "data/moonOreSiteRules.json"));
const snapshots = require(path.join(modRoot, "data/moonOreTemplates.v1.json"));

const universeFile = path.join(cleanRoot, transforms.TARGET);
const universeSource = fs.readFileSync(universeFile, "utf8");
const contentManagerFile = path.join(cleanRoot, "server/src/contentPacks/contentPackManager.js");
const officialPackFile = path.join(cleanRoot, "content-packs/evejs-ore-anomalies-1.1.0.json");
const familyEntries = Object.entries(snapshots.templatesByFamily);

let passed = 0;
function test(name, callback) {
  callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceAnchorVariant(source, anchor) {
  const matches = transforms.anchorVariants(anchor).filter((variant) => source.includes(variant));
  assert.equal(matches.length, 1, "expected one newline-specific form of the semantic anchor");
  return matches[0];
}

test("clean final EveJS 0.12.9 accepts the Moon loader and source-less identities", () => {
  const state = loader.install({
    runtimeRoot: cleanRoot,
    config: { enabled: true, verbose: false },
    rules,
    // The namespace formula is unchanged; one valid system is enough for this
    // port verifier and avoids repeating the accepted full-catalog gate.
    systemIDs: [30000001],
  });
  try {
    assert.equal(state.active, true);
    assert.equal(state.targets.dungeonUniverseRuntime.filename, universeFile);
    const inspected = transforms.inspectUniverseRuntime(universeSource, rules.siteIDBases);
    assert.equal(inspected.ok, true, inspected.reason);
    assert.equal((inspected.source.match(new RegExp(transforms.MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu")) || []).length, 1);
    for (const [family, snapshot] of familyEntries) {
      assert.ok(inspected.source.includes(`${family}: ${rules.siteIDBases[family]},`));
      assert.match(snapshot.templateID, /^evejs-mod:moon-ore:(r4|r8|r16|r32|r64):v1$/u);
      assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "sourceDungeonID"), false);
    }
  } finally {
    state.rollback();
  }
});

test("an unrelated incoming-source edit is accepted and preserved", () => {
  const eol = universeSource.includes("\r\n") ? "\r\n" : "\n";
  const unrelatedPrelude = `// unrelated synthetic edit owned outside Moon${eol}`;
  const incoming = unrelatedPrelude + universeSource;
  const transformed = transforms.transformUniverseRuntime(incoming, rules.siteIDBases);
  assert.ok(transformed.startsWith(unrelatedPrelude));
  assert.equal(transformed.includes("const BACKGROUND_RECONCILE_DELAY_MS = 25;"), true);
  if (eol === "\r\n") {
    assert.equal(/(^|[^\r])\n/u.test(transformed), false, "transform introduced unrelated LF line endings");
  }
});

test("altered, duplicated, and already-installed Moon seams fail closed", () => {
  const countAnchor = sourceAnchorVariant(universeSource, transforms.COUNT_ANCHOR);
  const altered = universeSource.replace(countAnchor, countAnchor.replace("countsByFamily", "countsForFamilies"));
  assert.throws(
    () => transforms.transformUniverseRuntime(altered, rules.siteIDBases),
    /moon fixed-count guard: anchor count 0, expected 1/u,
  );
  const eol = universeSource.includes("\r\n") ? "\r\n" : "\n";
  const duplicated = universeSource + eol + countAnchor;
  assert.throws(
    () => transforms.transformUniverseRuntime(duplicated, rules.siteIDBases),
    /moon fixed-count guard: anchor count 2, expected 1/u,
  );
  const installed = transforms.transformUniverseRuntime(universeSource, rules.siteIDBases);
  assert.throws(
    () => transforms.transformUniverseRuntime(installed, rules.siteIDBases),
    /MOON_TRANSFORM_ALREADY_APPLIED/u,
  );
});

test("the reviewed ore pack is exact and mismatched review metadata is rejected", () => {
  delete require.cache[contentManagerFile];
  const contentManager = require(contentManagerFile);
  const officialPack = JSON.parse(fs.readFileSync(officialPackFile, "utf8"));
  const validation = contentManager.validateContentPack(officialPack, { engineVersion: "0.12.9" });
  assert.deepEqual(
    {
      id: validation.id,
      version: validation.version,
      packSha256: validation.packSha256,
      payloadSha256: validation.payloadSha256,
    },
    contentOverlay.REVIEWED_OFFICIAL_ORE_PACK,
  );

  const basePayload = {
    templatesByID: {},
    spawnProfiles: { families: {} },
    meta: { installedContentPacks: [validation] },
  };
  const applied = contentOverlay.apply(basePayload, rules, snapshots, {
    modVersion: "port-verifier",
    contentRevision: "0.2.0",
    rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields,
  });
  for (const [family, snapshot] of familyEntries) {
    const template = applied.templatesByID[snapshot.templateID];
    const profile = applied.spawnProfiles.families[family];
    assert.ok(template);
    assert.equal(template.templateID, snapshot.templateID);
    assert.equal(template.siteFamily, family);
    assert.equal(Object.prototype.hasOwnProperty.call(template, "sourceDungeonID"), false);
    assert.ok(profile);
    assert.notEqual(profile.selectionAuthority, "strict_security_ore");
  }

  for (const [field, value] of [
    ["version", "1.1.0-mismatch"],
    ["packSha256", "0".repeat(64)],
    ["payloadSha256", "f".repeat(64)],
  ]) {
    const mismatch = clone(basePayload);
    mismatch.meta.installedContentPacks[0][field] = value;
    assert.throws(
      () => contentOverlay.apply(mismatch, rules, snapshots, {
        modVersion: "port-verifier",
        contentRevision: "0.2.0",
        rebuildDungeonDerivedFields: contentManager.rebuildDungeonDerivedFields,
      }),
      /MOON_OFFICIAL_ORE_PACK_MISMATCH/u,
    );
  }
});

console.log(`1..${passed}`);
