# MoonOreAnomalies 0.5.4

Version 0.5.4 fixes full-depletion completion and adds Launcher Configure controls. Automated lifecycle checks pass on 261028.1; **live respawn testing is still needed**. This release is available for community testing. The earlier user confirmation below concerns 0.5.3.

## Population and respawn controls

Launcher **Mods > MoonOreAnomalies > Configure** exposes the enable switch, verbose logging and:

| Setting | Public default | Meaning |
| --- | --- | --- |
| Moon spawn chance multiplier | 1 | Multiplies each existing family/security-band probability; 0 blocks new supply, 0.5 halves the chance, values above 1 increase it (clamped to 100%). |
| Maximum Moon anomalies per system | 0 | 0 keeps the previous uncapped distribution; 1–5 limits new Moon supply across all five families. |
| Mined-out respawn delay, minutes | 0 | 0 uses the next native rotation after grid teardown. A positive value starts at detected full depletion; replacement also waits for the old grid to empty. |

These are per-installation settings in `settings.json`. The public ZIP contains disabled/quiet defaults and no personal preset. Nonempty process environment still wins over JSON, legacy `.env`, then defaults. `.env.example` lists the three new variables. Settings changes require the normal Game server restart.

Density decisions and the cap are deterministic for a system/family. Lowering them preserves existing active sites and their remaining rocks; an over-cap installation drains down as those sites complete. A completed site reserves its seat during cooldown, so another Moon family cannot bypass the delay. The cooldown deadline is stored on the native dungeon instance and survives server reload; changing the configured delay affects subsequent completions, not a deadline already recorded. The engine may retire a completed slot without replacement if lower population settings no longer allow it.

Fully depleted owned Moon sites now enter the native `completed/depleted` lifecycle. Partial, unrecorded and unknown rock states never count as exhausted. The mod reuses native rock descriptors, persistence checks, occupied-grid teardown and the durable scheduler. No database wipe, template identity/content revision or client naming changes are involved. An already-empty site is detected when its scene is next materialized/ticked.

The new depletion/cooldown hooks validate against 0.12.9, 261018.1 and 261028.1 sources; the manifest retains its prior advertised versions. Legacy 0.12.8 predates the native all-rock depletion handler and retains its previous creation/gameplay behavior, with an explicit loader diagnostic that automatic mined-out completion is unavailable there. It is not newly certified for this feature.

Targeted offline checks: all five families at delays 0 and 15 minutes, reload preserving deadlines, partial/unknown rock states, foreign-site guards, occupied-grid hold, native durable rotation and stale jobs; 2000-system probability/cap checks plus 200 systems through the native planner; existing-site preservation; DCB/Solo naming/login composition; official Launcher 1.0.76 settings parser. No GUI or gameplay client was started for those checks.

Supports native EveJS `0.12.8`, `0.12.9`, `261028.1`. The 261028.1 port was checked with **EveJS Launcher 1.0.76** and EVE client **build 3396210**. The previous 0.5.3 release passed the user’s in-game checks on 2026-10-31; the automated port checks remain separate evidence. Older declared server support is retained, without claiming a new full certification of those versions.

## Install and update

Download `EveJS-MoonOreAnomalies-0.5.4.zip` from [Releases](https://github.com/Delta007a/EveJS-MoonOreAnomalies/releases/latest). Use Launcher **Mods > Add ZIP**, enable the mod and open **Configure**. Release ZIPs contain `loader.js.disabled` and start disabled. Configuration changes require a Game server restart; transient client features require a fresh client connection.

The package contains no personal `settings.json`, `.env`, runtime database or client archive. Launcher carries forward package-local files declared by the settings schema. Back up personal configuration before updating or removing a mod. For legacy customized source installations, transfer settings to the documented JSON configuration before updating; source files are replaced by updates.

## Behavior and defaults

Adds five Moon Ore anomaly families (R4 through R64) to the native anomaly lifecycle. Creation is **disabled by default**; verbose logging is also **false**. Enable the loader and the Configure creation switch when desired.

Settings are stored in `mods/moonOreAnomalies/settings.json`. Precedence: nonempty process environment, JSON settings, legacy `.env`, disabled/quiet defaults. Examples contain defaults only. Family/ore/probability rules remain in `data/moonOreSiteRules.json`; back up deliberate customizations before update. The reviewed `evejs.ore-anomalies@1.1.0` identity/hash guard remains mandatory and is not a user setting. Unknown computed namespace syntax fails closed; the new Homefront namespaces are reviewed explicitly.

## Names in the anomaly list, Probe Scanner and space

| Family | Transient client label |
| --- | --- |
| R4 | Ubiquitous Moon Ore Deposit (R4) |
| R8 | Common Moon Ore Deposit (R8) |
| R16 | Uncommon Moon Ore Deposit (R16) |
| R32 | Rare Moon Ore Deposit (R32) |
| R64 | Exceptional Moon Ore Deposit (R64) |

These describe native ore rarity families, not current market ISK value. Persistent template names and instance identities are retained to avoid content revision/instance churn. `client/names.json` defines presentation labels.

Launcher runs a read-only `prepare_server_start` preflight. On reviewed EveJS 261028.1 / client build 3396210, the loader injects a transient login patch into process memory. It checks all five native method fingerprints before changing ScannableSiteData, ScanSvc and AnomalyBracket consumers. A private Python namespace supports deferred handlers. No server source or `code.ccp` file is modified. Unsupported delivery retains valid native donor labels and ordinary unrelated anomalies remain native. Older declared EveJS versions retain gameplay support; the new transient naming seam is guarded for 261028.1.

The manifest loads Moon before SoloProgressionBalance and DroneClassBalance so their exact login ownership guards can compose. Names and fitting simulation coexist. Client hooks retire on disconnect/character change; reconnect installs a fresh session. Diagnostics distinguish `LOGIN_WRAPPER_READY`, `LOGIN_PAYLOAD_READY`, `MOON_NAMES:DELIVERED`, readiness and unsupported delivery.

## Safe removal

Keep the loader enabled, turn **Enable Moon Ore anomalies** off in Configure and restart once to retire owned anomalies. Confirm retirement success before disabling/removing the loader. Back up settings and deliberate rule customizations. No client archive restoration is needed.

## Provenance

Port of Delta0070's Moon Ore anomaly design/reference patch; see [CREDITS.md](CREDITS.md). Delta0070 has not endorsed this package. No separate license is asserted for that upstream patch; EveJS itself declares AGPL-3.0-only. No vendor client code is included.
