"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ENABLE_KEY = "EVEJS_MOON_ORE_ANOMALIES";
const VERBOSE_KEY = "EVEJS_MOON_ORE_ANOMALIES_VERBOSE";
const DEFAULTS = Object.freeze({ spawnChanceMultiplier: 1, maxSitesPerSystem: 0, respawnDelayMinutes: 0 });
const NUMERIC_KEYS = Object.freeze({spawnChanceMultiplier:"EVEJS_MOON_SPAWN_CHANCE_MULTIPLIER",
  maxSitesPerSystem:"EVEJS_MOON_MAX_SITES_PER_SYSTEM",respawnDelayMinutes:"EVEJS_MOON_RESPAWN_DELAY_MINUTES"});

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
  for (const key of Object.keys(value)) if (!["enabled", "verbose", ...Object.keys(DEFAULTS)].includes(key)) throw new Error(`Unknown Moon setting: ${key}`);
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
  const numbers = {};
  for (const [name, key] of Object.entries(NUMERIC_KEYS)) {
    const raw = pick(name, key);
    const value = raw === undefined || raw === null || raw === "" ? DEFAULTS[name] : Number(raw);
    const max = name === "spawnChanceMultiplier" ? 10 : name === "maxSitesPerSystem" ? 5 : 10080;
    if (!Number.isFinite(value) || value < 0 || value > max || (name === "maxSitesPerSystem" && !Number.isInteger(value))) {
      throw new Error(`Invalid Moon ${name}: expected ${name === "maxSitesPerSystem" ? "integer" : "number"} from 0 to ${max}`);
    }
    numbers[name] = value;
  }
  return Object.freeze({
    ...numbers,
    enabled: readBoolean(pick("enabled", ENABLE_KEY), false),
    verbose: readBoolean(pick("verbose", VERBOSE_KEY), false),
    enableKey: ENABLE_KEY, verboseKey: VERBOSE_KEY,
  });
}

module.exports = { DEFAULTS, NUMERIC_KEYS, ENABLE_KEY, VERBOSE_KEY, load, readBoolean, readEnvFile, readSettings };
