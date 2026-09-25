"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ENABLE_KEY = "EVEJS_MOON_ORE_ANOMALIES";
const VERBOSE_KEY = "EVEJS_MOON_ORE_ANOMALIES_VERBOSE";

function readEnvFile(file) {
  try {
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || match[1].startsWith("#")) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[match[1]] = value;
    }
    return values;
  } catch (_) { return {}; }
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function readSettings(modDir) {
  const file = path.join(modDir, "settings.json");
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Moon settings.json must contain an object");
  for (const key of Object.keys(value)) if (!["enabled", "verbose"].includes(key)) throw new Error(`Unknown Moon setting: ${key}`);
  return value;
}

function load(modDir, environment = process.env) {
  const fileValues = readEnvFile(path.join(modDir, ".env"));
  const settings = readSettings(modDir);
  const pick = (name, envKey) => {
    if (Object.prototype.hasOwnProperty.call(environment, envKey) && String(environment[envKey] ?? "").trim() !== "") return environment[envKey];
    if (Object.prototype.hasOwnProperty.call(settings, name)) return settings[name];
    return fileValues[envKey];
  };
  return Object.freeze({
    enabled: readBoolean(pick("enabled", ENABLE_KEY), false),
    verbose: readBoolean(pick("verbose", VERBOSE_KEY), false),
    enableKey: ENABLE_KEY, verboseKey: VERBOSE_KEY,
  });
}

module.exports = { ENABLE_KEY, VERBOSE_KEY, load, readBoolean, readEnvFile, readSettings };
