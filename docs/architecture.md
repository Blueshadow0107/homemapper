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

user-selected image ──► loopback OpenAI proxy ──► draft JSON ──► editor review

floorplan + thermal scenario ──► lumped-RC model ──► room temperature time series

floorplan + CFD scenario ──► thermal-LBM worker ──► temperature/velocity frames ──► CFD view
```

## Components

- **Plan editor:** edits room polygons and wall segments, scale, room names, ceiling height, wall material, and wall exposure. It supports moving shared vertices, adding/deleting walls, adding rectangular rooms, undo, sanity warnings, and JSON import/export. Every edit updates the 3D shell and prediction.
- **Floorplan data:** room polygons and wall segments in metre-based plan coordinates. The current bundled plan is schematic.
- **3D viewer:** renders the shell, router, spot-check pins, and predicted field. It exposes router and mark placement events to the app.
- **Wi-Fi model:** `wifi-model/index.js` exports pure `predict(router, floorplan, cellSize)`. It estimates path loss by distance and crossed wall/opening attenuation, then omits cells outside room polygons. Defaults are 17 dBm transmit power and path-loss exponent 3; both can be overridden in the router input. The UI selects 2.4 or 5 GHz, accepts an optional transmit-power override, and warns when spot-check and model bands differ. `interpolate(...)` remains available for later use with measured readings.
- **Wi-Fi sampler:** `tools/wifi-sampler/` exposes browser-safe `sampleRssi()` and a Linux `iw` CLI/server. The loopback server allows the browser to request a local reading; manual input remains a fallback.
- **OpenAI API:** implemented user-triggered floorplan-image-to-geometry draft through `server/` on loopback. `OPENAI_API_KEY` stays in the server process environment. The UI marks the result unverified and loads it into the editor with warnings and a source-image underlay. A synthetic image passed through the real API and browser flow, returning two rooms/five walls; the UI correctly warned that scale was guessed. Arbitrary real-plan extraction accuracy still needs user-plan review.
- **Thermal model:** `thermal-model/index.js` exports pure `simulate(floorplan, scenario)`, returning per-room temperature time series and heater energy. It uses a lumped-RC approximation with conduction, infiltration, and constant heater power. The UI places/clears heaters, sets outdoor temperature, switches to the heating layer, shows room tint/labels, and scrubs the returned time series. Model tests are reported passing.
- **Thermal CFD (approved, implementation pending):** a native coarse 3D thermal lattice-Boltzmann solver in a Web Worker. Boussinesq buoyancy, D3Q19 flow + D3Q7 temperature, voxelized air/solid masks, heater sources, and material-aware heat-loss boundaries. No explicit solid mesh in v1. Keep the existing RC mode as a fast comparison. Validate the solver separately against cavity benchmarks before treating house-plan output as useful.

## Viewer and Wi-Fi interface

- Plan coordinates are metres `[x,z]`, with plan `z` increasing downward. The viewer maps `[x,z]` to world `[x,0,-z]`.
- In router placement mode, the viewer dispatches `twin:router` with `{detail:{position_m:[x,z]}}`.
- In spot-check mode, it dispatches `twin:mark` with `{detail:{position_m:[x,z]}}`.
- The editor passes changed geometry to `viewer.setFloorplan(floorplan, {refit})`; geometry changes rebuild the shell and trigger a fresh prediction.
- Router shape: `{position_m:[x,z], height_m, frequency_hz, tx_power_dbm?, path_loss_exponent?}`.
- A measured sample is `{id, position_m:[x,z], rssi_dbm, frequency_hz?, sampled_at?, source:'iw'|'manual'}`.
- A field is `{method, cell_size_m, cells:[{position_m:[x,z], estimated_rssi_dbm}]}`. Cells outside rooms are omitted.
- The viewer's `setRouter`, `setSamples`, and `setField` consume these values; the app owns model invocation and orchestration.

## Planned thermal CFD interface

Kimi owns the solver under `thermal-cfd/**`; Claude owns the Worker/UI integration in `src/**`. The current viewer proposal uses a grid `{origin_m:[x,z], cell_m, nx, nz, ny, height_m, cell_type}` and streamed `{time_s, temperature_c, velocity_m_s}` frames. Cell indices are x-fastest: `((iy*nz)+iz)*nx+ix`; plan `[x,z]` maps to world `[x,y,-z]`, and velocity components are world XYZ. Grid codes and exact worker messages are being reconciled with the solver owner in `../hackathon-2026-11/CHANNEL.md`; see [data-contract.md](data-contract.md).

## Boundaries

- The browser cannot invoke Linux wireless commands directly. Use the local loopback sampler or manual readings.
- Predicted values are simplified estimates, not calibrated coverage or survey results. Keep them distinct from spot-check readings.
- Store floorplan and readings locally for the demo. Image upload is user-triggered, goes through the loopback proxy, and returns editable draft geometry with visible warnings.
- Thermal values are approximate, not calibrated building-energy predictions. The UI should expose scenario assumptions and distinguish estimates from measured temperatures.

See [data-contract.md](data-contract.md) for the shared structures. Claude owns `src/**`, `index.html`, and the sample plan; Kimi owns `wifi-model/**`, `tools/wifi-sampler/**`, `thermal-model/**`, and `thermal-cfd/**`; Codex maintains docs and project instructions.
