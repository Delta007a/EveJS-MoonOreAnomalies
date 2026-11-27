"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

const LOGIN_BUILDS = new Map([
  ["c84cffe20c00cf075a97daa31ca53c435af4f14c814e46d828760dbbb55fb566", [3396210]],
  ["5e6d7445213c89c8ad58d58ace38ac1f08d6ebfb40f7ef7c4a2491626a8dab15", [3396210]],
  ["7aaa72247049b38d3f656f3b2c602877a8bcf0d9ff0af68f1795ff1327565ba7", [3396210, 3724492]],
]);
const HANDSHAKE = "server/src/network/tcp/handshake.js";
const KEY = Symbol.for("evejs.moonOreAnomalies.transientNames");
const OWNER = 'globalThis[Symbol.for("evejs.moonOreAnomalies.transientNames")]';
const LOGIN_CALL = /buildTidiSignedFunc\(this\.clientId(?:, \{ accountRole: this\.accountRole \})?\)/g;
const LOGIN_TUPLE = /^[ \t]*\[.*buildTidiSignedFunc\(this\.clientId(?:, \{ accountRole: this\.accountRole \})?\).*, (?:false\], \/\/ func tuple: \[marshaled_code, verification\]|0\],)\r?$/m;
const PACKET_LIMIT = 256 * 1024;

function extendLogin(source) {
  if ([...source.matchAll(LOGIN_CALL)].length !== 1 || !LOGIN_TUPLE.test(source)) return null;
  const compose = `((packet) => ${OWNER}?.compose(this.socket, packet) ?? packet)`;
  return source.replace(LOGIN_CALL, call => `${compose}(${call})`);
}

function extendSignature(source) {
  const start = source.indexOf("function buildAnomalySiteInfo(site) {");
  const end = source.indexOf("\nfunction ", start + 1);
  if (start < 0 || end < 0) return null;
  const part = source.slice(start, end);
  if (part.split("  return buildKeyVal([").length !== 2 || !/^  \]\);\r?$/m.test(part)) return null;
  const changed = part.replace("  return buildKeyVal([", "  const info = buildKeyVal([")
    .replace(/^  \]\);(\r?\n)/m, `  ]);$1  return ${OWNER}?.remember(site, info) ?? info;$1`);
  return source.slice(0, start) + changed + source.slice(end);
}

function extendScanner(source) {
  const scopedMissionSites = source.includes("function buildCachedSignalTrackerFullState(systemID, session = null)");
  const broadcastState = scopedMissionSites ? "buildCachedSignalTrackerFullState(systemID, session)" : "fullState";
  const registeredState = scopedMissionSites
    ? "buildCachedSignalTrackerFullState(systemID, notificationSession)"
    : "buildCachedSignalTrackerFullState(systemID)";
  const liveState = scopedMissionSites
    ? "buildLiveSignalTrackerFullState(systemID, options, session)"
    : "buildLiveSignalTrackerFullState(systemID, options)";
  const project = (session, state) => `((state) => ${OWNER}?.fullState(${session}, state) ?? state)(${state})`;
  const replacements = [
    [`const payload = [systemID, ${broadcastState}];`,
      `const payload = [systemID, ${project("session", broadcastState)}];`],
    [`[systemID, ${registeredState}],`,
      `[systemID, ${project("notificationSession", registeredState)}],`],
    [`return ${liveState};`, `return ${project("session", liveState)};`],
    ['"OnSignalTrackerAnomalyUpdate",\n      "charid",\n      payload,',
      `"OnSignalTrackerAnomalyUpdate",\n      "charid",\n      ${OWNER}?.delta(session, payload) ?? payload,`],
    ['session.sendNotification("OnCosmicAnomalyAdded", "solarsystemid2", [siteInfo]);',
      `session.sendNotification("OnCosmicAnomalyAdded", "solarsystemid2", [${OWNER}?.anomaly(session, siteInfo) ?? siteInfo]);`],
    ['getTrackerInfoField(siteInfo, "dungeonID", 0)',
      `getTrackerInfoField(${OWNER}?.anomaly(session, siteInfo) ?? siteInfo, "dungeonID", 0)`],
  ];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [from, to] of replacements) {
    const anchor = from.replace(/\n/g, newline);
    if (source.split(anchor).length !== 2) return null;
    source = source.replace(anchor, () => to.replace(/\n/g, newline));
  }
  return source;
}

const TARGETS = [
  [HANDSHAKE, extendLogin],
  ["server/src/services/exploration/signatures/signatureRuntime.js", extendSignature],
  ["server/src/services/exploration/scanMgrService.js", extendScanner],
];

function getClientBuild(root) {
  try {
    const baseline = fs.readFileSync(path.join(root, HANDSHAKE), "utf8");
    const hash = crypto.createHash("sha256").update(baseline.replace(/\r\n/g, "\n")).digest("hex");
    const builds = LOGIN_BUILDS.get(hash);
    if (!builds) return null;
    const profile = require(path.resolve(root, "server/src/network/protocolProfile.js"));
    const clientBuild = profile.CLIENT_COMPATIBILITY_PROFILE?.clientBuild;
    if (!builds.includes(clientBuild)) return null;
    for (const [file, transform] of TARGETS) {
      const source = file === HANDSHAKE ? baseline : fs.readFileSync(path.join(root, file), "utf8");
      if (transform(source) === null) return null;
    }
    return clientBuild;
  } catch (_) {
    return null;
  }
}

function install(root, modRoot) {
  if (globalThis[KEY]) return globalThis[KEY];
  const clientBuild = getClientBuild(root);
  if (clientBuild === null) {
    return { active: false, reason: "unsupported-client-login-or-scanner" };
  }
  const transforms = new Map(TARGETS.map(([file, transform]) => [path.resolve(root, file), transform]));
  if (Object.keys(Module._cache).some(file => transforms.has(path.resolve(file)))) {
    return { active: false, reason: "transient-naming-target-already-loaded" };
  }
  const snapshots = require("../data/moonOreTemplates.v1.json").templatesByFamily;
  const displayNames = JSON.parse(fs.readFileSync(path.join(modRoot, "client/names.json"), "utf8"));
  if (Object.keys(displayNames).length !== Object.keys(snapshots).length ||
      Object.keys(displayNames).some(family => !Object.hasOwn(snapshots, family))) {
    throw Error("MOON_NAMES_FAMILY_MISMATCH");
  }
  // The same private token range is used in this process's login and scan packets.
  const firstToken = -crypto.randomInt(100_000_000, 2_000_000_000);
  const rows = Object.entries(snapshots).map(([family, row], index) => {
    const displayName = displayNames[family];
    if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 128) {
      throw Error("MOON_NAMES_LABEL_INVALID");
    }
    return { family, ...row, displayName, token: firstToken - index };
  });
  const byTemplate = new Map(rows.map(row => [row.templateID, row]));
  const names = Object.fromEntries(rows.map(row => [row.token, [row.displayName, row.historicalDungeonNameID]]));
  const body = fs.readFileSync(path.join(modRoot, "client/names.py"), "utf8") +
    "\nstart(" + JSON.stringify(names).replace(/"(-\d+)":/g, "$1:") + ", _moon_context, " + clientBuild + ")\n";
  const program = "try:\n" + body.split("\n").map(line => " " + line).join("\n") +
    '\nexcept Exception as error:\n print("MOON_NAMES:DELIVERY_FAILED:%s" % type(error).__name__)\n';
  const encoded = Buffer.from(program, "utf8").toString("base64");
  const expression = `eval(compile(__import__('base64').b64decode('${encoded}'), '<moon-transient-names>', 'exec'), {'__builtins__': __builtins__, '_moon_context': globals()})`;

  // Snapshots stay native and can be shared. Only the outgoing view for a socket
  // that got this payload receives temporary IDs.
  const delivered = new WeakSet();
  const siteRows = new WeakMap();
  const announced = new Set();
  function anomaly(info) {
    const row = siteRows.get(info);
    if (!row) return info;
    if (!announced.has(row.family)) {
      announced.add(row.family);
      console.log("[moonOreAnomalies/names] ANOMALY_WIRE_READY family=" + row.family + " token=" + row.token);
    }
    const entries = info.args.entries.map(entry => {
      if (entry[0] === "dungeonID") return [entry[0], row.token];
      if (entry[0] === "dungeonNameID") return [entry[0], row.historicalDungeonNameID];
      return entry;
    });
    return { ...info, args: { ...info.args, entries } };
  }
  function project(dict) {
    return { ...dict, entries: dict.entries.map(([id, info]) => [id, anomaly(info)]) };
  }

  const previous = Module.prototype._compile;
  const state = {
    active: true,
    rows,
    compose(socket, original) {
      delivered.delete(socket);
      if (!state.active || !socket || typeof socket !== "object" || !Buffer.isBuffer(original) || original.length <= 5 ||
          original.length > PACKET_LIMIT + 5 || original[0] !== 0x74 ||
          original.readUInt32LE(1) !== original.length - 5) return original;
      const prior = original.subarray(5).toString("latin1");
      if (!prior.trim() || /[^\x09\x0a\x0d\x20-\x7e]/.test(prior)) return original;
      const data = Buffer.from(`(lambda r: (${expression}, r)[1])(${prior})`, "ascii");
      if (data.length > PACKET_LIMIT) return original;
      const header = Buffer.alloc(5);
      header[0] = 0x74;
      header.writeUInt32LE(data.length, 1);
      const packet = Buffer.concat([header, data]);
      delivered.add(socket);
      console.log("[moonOreAnomalies/names] LOGIN_PAYLOAD_READY bytes=" + data.length);
      return packet;
    },
    remember(site, info) {
      const row = byTemplate.get(site?.templateID);
      if (row && (!site.family || site.family === row.family)) siteRows.set(info, row);
      return info;
    },
    fullState(session, fullState) {
      return state.active && delivered.has(session?.socket) ? [project(fullState[0]), ...fullState.slice(1)] : fullState;
    },
    delta(session, payload) {
      return state.active && delivered.has(session?.socket) ? [payload[0], project(payload[1]), payload[2]] : payload;
    },
    anomaly(session, info) {
      return state.active && delivered.has(session?.socket) ? anomaly(info) : info;
    },
    restore() {
      if (Module.prototype._compile === hook) Module.prototype._compile = previous;
      if (globalThis[KEY] === state) delete globalThis[KEY];
    },
  };
  function hook(content, filename) {
    const transform = transforms.get(path.resolve(filename));
    if (state.active && transform) {
      const transformed = transform(content);
      if (transformed !== null) {
        content = transformed;
        if (transform === extendLogin) console.log("[moonOreAnomalies/names] LOGIN_WRAPPER_READY");
      } else {
        state.active = false;
        console.warn("[moonOreAnomalies/names] WIRE_SEAM_UNAVAILABLE: " + path.basename(filename));
      }
    }
    return previous.call(this, content, filename);
  }
  Module.prototype._compile = hook;
  globalThis[KEY] = state;
  return state;
}

module.exports = { install, getClientBuild };
