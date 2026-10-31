# MoonOreAnomalies 0.5.3

Supports native EveJS `0.12.8`, `0.12.9`, `261028.1`. The 261028.1 port was checked with **EveJS Launcher 1.0.76** and EVE client **build 3396210**. The user confirmed all four mods passed in-game verification on 2026-10-31; the automated port checks remain separate evidence. Older declared server support is retained, without claiming a new full certification of those versions.

## Install and update

Download `EveJS-MoonOreAnomalies-0.5.3.zip` from [Releases](https://github.com/Delta007a/EveJS-MoonOreAnomalies/releases/latest). Use Launcher **Mods > Add ZIP**, enable the mod and open **Configure**. Release ZIPs contain `loader.js.disabled` and start disabled. Configuration changes require a Game server restart; transient client features require a fresh client connection.

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
