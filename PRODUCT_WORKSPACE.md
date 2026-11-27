# Agro-Consultas — unified GIS workspace

**Revisión de estado:** 27 de noviembre de 2026. Producción verificada sobre `e1203bb`; consultar [auditoría de producción](docs/PRODUCTION_AUDIT_2026-11-27.md) para diferencias entre producción y la rama de mantenimiento. Los proyectos, lotes y snapshots de informes se guardan localmente en el navegador: no se sincronizan automáticamente entre dispositivos.\n
## Product direction
Agro-Consultas is an Argentina-wide GIS workspace for producers, technical professionals and agricultural/forestry businesses. Its workflow is: select a territory, inspect evidence, run a domain analysis, and export a traceable result.

## Shared interaction model
- Desktop: persistent module navigation, central map/work surface, contextual analysis panels.
- Mobile: primary map or result first; secondary controls and supporting information remain compact, scrollable or collapsible. A shared bottom navigation provides access to the main work areas.
- Projects and saved lots are stored locally in `agro_workspace_v1`; the active GeoJSON remains available to existing modules through `agro_lot_context_v1`. Users can create projects and switch between saved lots without an account. The initial workspace is empty and never creates a sample lot or synthetic geometry.

## Product areas
1. Territorial workspace: projects, lots, GeoJSON, shared geometry and layer context.
2. Agro suitability: explainable crop/forestry candidates, source-aware diagnostics and comparisons.
3. Forest monitoring: Sentinel-2 scene discovery, valid raster-derived indices, time comparisons and field evidence.
4. Fire monitoring: national hotspot exploration, sensor/time filters, cluster inspection and lot exposure.
5. Climate/environment: historical and current variables with explicit source, period and units.
6. Field/GPS and reporting: georeferenced observations, exports and configurable technical reports.

## Data communication
The interface should avoid generic blocking warnings and repetitive "insufficient data" labels. Explain a source or processing limitation in the relevant detail panel, keep unaffected tools usable, and never replace missing observations with invented values. Preserve provenance, observation date, query date, units and method for derived results.

## Current implementation in this branch
- Added shared responsive workspace assets (`workspace.css`, `workspace.js`) to the seven primary HTML entry points.
- Added common desktop navigation and mobile bottom navigation across the seven primary entry points.
- Added local multi-project and multi-lot storage, project/lot selectors, and a compact active-territory label. Existing lots are migrated into the default workspace when first opened.
- Central map, forest, fire, and tracking workflows now subscribe to shared-lot changes; tracking does not replace a route while GPS capture is active.
- Report coordinates derived from a lot use the geometry centroid utility and identify the coordinate source instead of labelling a bounding-box center as a centroid.
- The report's crop matrix now uses the same subregional candidate profile and NASA POWER 2001–2020 climate evidence as the main suitability flow.
- Fire monitoring includes an interactive recent-detections carousel; selecting an item centers the map and opens its source attributes.
- The six planned integration workstreams are covered: shared territorial workspace; map and fire workflow; forest/environment lot synchronization; agro suitability synchronization and evidence labels; GPS tracking and report consistency; and automated regression/build validation.
- This release integrates the existing domain modules rather than replacing their scientific services or claiming new analytical models. Source limitations remain visible in context; the integration does not manufacture measurements, recommendations or sample lots.
- Automated validation is green. Full visual review across device sizes and live-source smoke tests must be completed against the production deployment after merge; the latest Vercel preview build was blocked by the account build-rate limit.

## Validation
Run:
```bash
python tests/workspace_integration.test.py -v
python tests/check_frontend_syntax.py
node --experimental-default-type=module --test tests/lotContext.test.mjs tests/fireMonitoring.test.mjs tests/forestGeo.test.mjs tests/territorial-recommendations.test.mjs tests/forestry-candidates-ui.test.mjs tests/satelliteService.test.mjs
```
