# Architecture

## Data flow

```text
JSON floorplan ──► 2D plan editor ──► one router
              │
              ▼
     deterministic Wi-Fi prediction ◄── wall geometry/materials
              │
              ▼
      labelled field in 3D viewer

optional marked spot ──► local RSSI sampler or manual entry
                                   │
                                   ▼
                         compare reading to prediction

user-selected image ──► loopback OpenAI proxy ──► draft JSON ──► editor review ──► (optional) review hints ──► (optional) re-read with findings

floorplan + thermal scenario ──► lumped-RC model ──► room temperature time series

floorplan + CFD scenario ──► thermal-LBM worker ──► temperature/velocity frames ──► Airflow view (qualitative)
```

## Components

- **Plan editor (`src/editor.js`, step 1 "2D plan"):** room polygons, wall segments, scale, room names, ceiling height, wall material and exposure; shared-vertex moves, add/delete walls and rectangular rooms, furniture placement (radiators snap to the nearest wall), undo, sanity warnings, JSON import/export (under "File"), and an underlay of the source image for drafts. All imported or AI plans pass `normalizePlan` (`src/plan-schema.js`), which whitelists and clamps every field.
- **Floorplan data:** metre-based plan coordinates. The bundled plan is schematic.
- **3D viewer (`src/viewer.js`, step 2 "3D view"):** shell, router, spot-check pins, the Wi-Fi field, heating tint/labels and furniture. It exposes router, mark and radiator placement to the app. The Wi-Fi/Heating/Airflow cards, claim pills and settings live in `index.html` and `src/main.js`.
- **Wi-Fi model:** `wifi-model/index.js`, pure `predict(router, floorplan, cellSize)`: log-distance path loss plus per-wall/opening attenuation, cells outside rooms omitted. Defaults 17 dBm and exponent 3, band selectable, spot-check band mismatches flagged.
- **Wi-Fi sampler:** `tools/wifi-sampler/` (browser-safe `sampleRssi()` and a Linux `iw` CLI/loopback server that validates Host/Origin). Returns `frequency_hz`, `freq_mhz` and `band`; manual input is the fallback.
- **AI draft (`server/index.js`, `src/draft.js`, `src/upload-dialog.js`):** user crops one plan and may enter its real width; the loopback proxy calls the OpenAI vision API (default `gpt-5.5`, `OPENAI_MODEL` or `?model=` to change) with a strict JSON schema in which rooms are axis-aligned boxes (polygons only for non-rectangular rooms). The converter builds rectangles, straightens skewed ones, drops slanted walls on rectilinear plans, adds missing room-edge walls, scores completeness (ok / review / poor) and loads the result as an unverified draft. `/api/review` returns text-only hints (box coordinates proved unreliable and are not drawn); `/api/draft` accepts the findings as `feedback` for a corrective re-read. `OPENAI_API_KEY` lives only in the proxy's environment.
- **Heating model:** `thermal-model/index.js`, pure `simulate(floorplan, scenario)` returning per-room temperature series and heater energy; lumped RC with conduction, inter-room transfer, infiltration and constant radiator power. Heaters are derived from `plan.furniture` entries whose catalog type has a `heat_source` (radiators). This is the only quantitative temperature view.
- **Airflow (`thermal-cfd/**`, `src/cfd/`):** a native coarse 3D thermal lattice-Boltzmann solver (D3Q19 flow, D3Q7 temperature, Boussinesq buoyancy) in a Web Worker, fed by the same radiators and by furniture AABBs as solid obstacles. It is deliberately **uncalibrated** (it delivers only a fraction of the scenario's heater energy), so the UI shows relative warmth and arrows only; arrow size is normalised for display to the run's peak speed. `src/cfd/fixture.js` is a fallback when the worker is unavailable.
- **Furniture (`assets/furniture/`):** `generate.mjs` builds `catalog.json` procedurally (boxes, cylinders, spheres); no external meshes or textures. `src/furniture.js` and `src/furniture-geometry.js` validate and build the 3D pieces.


## Viewer and Wi-Fi interface

- Plan coordinates are metres `[x,z]`, with plan `z` increasing downward. The viewer maps `[x,z]` to world `[x,0,-z]`.
- In router placement mode, the viewer dispatches `twin:router` with `{detail:{position_m:[x,z]}}`.
- In spot-check mode, it dispatches `twin:mark` with `{detail:{position_m:[x,z]}}`.
- The editor passes changed geometry to `viewer.setFloorplan(floorplan, {refit})`; geometry changes rebuild the shell and trigger a fresh prediction.
- Router shape: `{position_m:[x,z], height_m, frequency_hz, tx_power_dbm?, path_loss_exponent?}`.
- A measured sample is `{id, position_m:[x,z], rssi_dbm, frequency_hz?, sampled_at?, source:'iw'|'manual'}`.
- A field is `{method, cell_size_m, cells:[{position_m:[x,z], estimated_rssi_dbm}]}`. Cells outside rooms are omitted.
- The viewer's `setRouter`, `setSamples`, and `setField` consume these values; the app owns model invocation and orchestration.

## Airflow interface

The solver owner (`thermal-cfd/**`) and the UI (`src/cfd/**`) exchange a grid `{origin_m:[x,z], cell_m, nx, nz, ny, height_m, cell_type}` and streamed `{time_s, temperature_c, velocity_m_s}` frames over a `run`/`cancel` worker protocol (`grid`, `frame`, `progress`, `done`, `error`). Indices are x-fastest: `((iy*nz)+iz)*nx+ix`; plan `[x,z]` maps to world `[x,y,-z]`. `done.stats` carries `uncalibrated:true` and energy-balance diagnostics. Details in [data-contract.md](data-contract.md).

## Boundaries

- The browser cannot invoke Linux wireless commands directly. Use the local loopback sampler or manual readings.
- Predicted values are simplified estimates, not calibrated coverage or survey results. Keep them distinct from spot-check readings.
- Store floorplan and readings locally for the demo. Image upload is user-triggered, goes through the loopback proxy, and returns editable draft geometry with visible warnings.
- Heating values are approximate, not calibrated building-energy predictions. Airflow is qualitative and must not be compared with them. The UI labels each layer *Estimated*, *Quantitative estimate* or *Qualitative*.

See [data-contract.md](data-contract.md) for the shared structures. The README credits the third-party software the project builds on.
