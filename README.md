# MoonOreAnomalies 0.5.0

Adds five Moon Ore anomaly families, R4 through R64, to the server's ordinary anomaly lifecycle. It uses client-known presentation data and needs no EVE client patch. Supports native EveJS 0.12.8 and final 0.12.9.

## Install and configure

Use **EveJS Launcher v1.0.65 → Mods → Add ZIP**, select the release ZIP, enable the mod and restart the Game server. The release ZIP starts disabled. **Configure** exposes the Moon anomaly enable switch and verbose logging. The complex family, ore and probability rules remain in `data/moonOreSiteRules.json`; edit those only with a backup and a full validation run. The official ore-pack identity guard is fixed safety policy, not a user setting. A manual Native server can preload `mods/moonOreAnomalies/loader.js` with Node `--require` before EveJS modules load.

The Launcher writes `mods/moonOreAnomalies/settings.json` and carries it forward during updates. For older installations, copy `.env` values to `settings.json` before replacing the package; the public ZIP contains no personal `.env`. Precedence is nonempty process environment, then `settings.json`, then legacy `.env`, then disabled/quiet defaults. `.env.example` documents the environment names.

## Compatibility and removal

This mod coexists with official Moon Mining, the reviewed `evejs.ore-anomalies@1.1.0` pack and DED-rated sites. Its Moon templates use separate identities, and it fails closed if the reviewed official pack changes unexpectedly. Disable its Configure enable switch and restart to retire owned anomalies before removing the package. Back up `settings.json` if you want to keep preferences; Launcher Remove deletes package-local settings.

Final 0.12.9 certification: 120/120 targeted tests, four clean-final port checks and all four-loader orders passed. Final live gameplay remains to be checked.

## Provenance

This is a port of Delta0070's Moon Ore anomaly design and reference patch. Read `CREDITS.md` for attribution and the differences in this port. Delta0070 has not endorsed this package. No separate license is asserted for that upstream patch here; EveJS itself declares AGPL-3.0-only.
