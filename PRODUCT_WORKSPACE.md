# Agro-Consultas — unified GIS workspace

## Product direction
Agro-Consultas is an Argentina-wide GIS workspace for producers, technical professionals and agricultural/forestry businesses. Its workflow is: select a territory, inspect evidence, run a domain analysis, and export a traceable result.

## Shared interaction model
- Desktop: persistent module navigation, central map/work surface, contextual analysis panels.
- Mobile: primary map or result first; secondary controls and supporting information remain compact, scrollable or collapsible. A shared bottom navigation provides access to the main work areas.
- Project context is shared across modules through the existing `agro_lot_context_v1` browser key. The shared shell reads that context for display only; it does not create a default lot or synthetic geometry.

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
- Added a common module navigation and a compact active-territory label sourced from the existing local lot context.
- Added a mobile bottom navigation and responsive layout rules for map-first use.
- This is the integration foundation, not completion of every analytical capability listed above. Existing module-specific workflows and data services remain authoritative and require separate functional and visual validation before production release.

## Validation
Run:
```bash
python -m unittest tests/workspace_integration.test
python -m unittest discover -s tests
```
