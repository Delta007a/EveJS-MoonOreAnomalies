# Credits and provenance

MoonOreAnomalies is a port of **Delta0070's** Moon Ore anomaly work, originally distributed as `EveJS-v0.12.6-moon-ore-anomalies-v1-final.patch` (SHA-256 `1BAB66977FD8EDA5A93A547D39E913AC8587D0478FBFC3C2AAD1E33D49B3E43F`). The original targeted EveJS 0.12.6 with Cosmic Site Distribution r2. Delta0070 has not endorsed this port and is not responsible for its bugs.

The original work defines the five R4/R8/R16/R32/R64 site families, donor presentation identities, four ores and sixteen rocks per site, tier quantities, security-band distribution, Pochven exclusion, spawn probabilities, lifetime and site-ID namespace design. Delta0070 also established the gameplay behavior in EveJS 0.12.6 and diagnosed the missing site-ID namespace failure that would otherwise make planned anomalies disappear during reconciliation.

This package retains those gameplay rules in `data/moonOreSiteRules.json` and the port's reviewed client presentation snapshots in `data/moonOreTemplates.v1.json`. Its attachment mechanism uses a CommonJS loader, an in-memory `dungeonUniverseRuntime.js` semantic transform and narrow export overlays. It does not edit EveJS source files on disk.

EveJS 0.12.8 and final 0.12.9 include `evejs.ore-anomalies@1.1.0`, which uses the historical client dungeon identities. This port gives Moon templates distinct `evejs-mod:moon-ore:*` identities and keeps donor IDs as presentation provenance. It verifies the official pack's reviewed identity before combining content and preserves ordinary ore and DED-rated sites. The scanner overlay maps Moon families to EveJS's ore scan-strength attribute so the client Anomalies menu can group them safely. The lifecycle overlay retires only this mod's owned sites.

No separate license from Delta0070's reference patch was supplied with this package. This repository does not claim ownership of his design or assign a license to his contribution. EveJS itself declares AGPL-3.0-only.
