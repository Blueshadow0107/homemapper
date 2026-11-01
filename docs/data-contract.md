# Data contract

This contract connects the floorplan, 3D viewer, local Wi-Fi sampler, and router-driven prediction model. Keep measured spot checks separate from predicted values.

## Coordinates

- Plan coordinates are metres stored as `[x,z]`.
- `x` increases rightward; plan `z` increases downward.
- The viewer maps plan `[x,z]` to Three.js world `[x,0,-z]`; world Y is vertical.

## Floorplan

```json
{
  "name": "Hackathon venue",
  "units": "m",
  "ceiling_height_m": 2.7,
  "rooms": [{ "id": "hall", "name": "Hall", "polygon": [[0,0],[8,0],[8,4],[0,4]] }],
  "walls": [{ "id": "wall-1", "a": [0,0], "b": [8,0], "thickness_m": 0.16, "exposure": "exterior", "material_id": "brick" }],
  "openings": [],
  "materials": {
    "brick": { "wifi_loss_db_2p4": 8, "wifi_loss_db_5": 12, "u_value_w_m2k": 1.5 },
    "plasterboard": { "wifi_loss_db_2p4": 4, "wifi_loss_db_5": 5, "u_value_w_m2k": 2.5 }
  }
}
```

Room polygons and wall endpoints use the same plan coordinates. Room records have `id`, `name`, and `polygon`. Walls may have an `id`; they identify `material_id` and `exposure` (`interior` or `exterior`). The editor keeps the legacy `type` field in sync with `exposure`. Optional openings reference a wall and can specify type, position, width, material, and closed state. Material Wi-Fi attenuation can be overridden under `materials`.

The plan editor imports and exports this floorplan JSON shape. It edits shared room/wall vertices, adds or deletes walls and rectangular rooms, sets wall material/exposure and room names, adjusts `ceiling_height_m`, and can scale the whole plan (including router position) from a known wall length. It does not currently edit openings/material definitions.

## Image-to-plan draft

The user-selected image goes to the local server proxy; the API returns normalized draft geometry, not final dimensions. Extraction shape: rooms contain `{name, polygon:[{x,y}]}`, walls contain `{a:{x,y}, b:{x,y}, exterior}`, `printed_overall_width_m` is a printed dimension or `null`, and `notes` describe uncertainty. Coordinates are normalized 0–1000 relative to the image, with x right and y down.

The browser transforms this into `{floorplan, underlay, warnings}`. The floorplan uses the normal metre-based contract and includes `draft:{source:'vision',reviewed:false}`. The underlay is `{x,y,w,h}` in plan metres; warnings must remain visible, especially when scale is guessed or geometry is repaired. If no printed overall width is extracted, the transformer assumes a 12 m longest side and explicitly tells the user to select a wall and set its real length. Supported image uploads are PNG, JPEG, and WebP. The draft is not trusted until the user edits/reviews and confirms it.

## Router

One router drives the primary prediction:

```json
{ "position_m": [2, 2], "height_m": 1, "frequency_hz": 2400000000 }
```

The UI defaults to 2.4 GHz and leaves `tx_power_dbm` unset so the model's 17 dBm fallback applies. Users may choose 5 GHz or enter an override. The model's path-loss exponent defaults to 3 and accepts an explicit `path_loss_exponent` override. Moving the router or changing its band/power triggers a new prediction; the UI warns when a spot-check sample's recorded band differs from the selected model band.

## Spot-check sample

A sample is one observed reading at a location. `source` is `iw` or `manual`; frequency and timestamp are optional. Do not persist SSID or BSSID by default.

```json
{
  "id": "sample-001",
  "position_m": [3.2, 1.4],
  "rssi_dbm": -67,
  "frequency_hz": 2412000000,
  "sampled_at": "2026-11-01T14:00:00Z",
  "source": "iw"
}
```

## Predicted field

Pure ESM `predict(router, floorplan, cellSize)` from `wifi-model/index.js` produces estimated cells. Cells outside rooms are omitted. Predictions do not depend on spot-check readings.

```json
{
  "method": "multiwall",
  "cell_size_m": 0.5,
  "cells": [
    { "position_m": [0.25, 0.25], "estimated_rssi_dbm": -68.4 },
    { "position_m": [0.75, 0.25], "estimated_rssi_dbm": -69.2 }
  ]
}
```

Secondary `interpolate(bounds, samples, cellSize, floorplan?)` is available for sample-based interpolation later. Label the primary field as predicted and keep it visually distinct from spot-check pins.

## Viewer and sampler interface

- Router placement dispatches `twin:router` with `{detail:{position_m:[x,z]}}`.
- Spot-check placement dispatches `twin:mark` with `{detail:{position_m:[x,z]}}`.
- The viewer exposes `setFloorplan(floorplan, {refit})`, `setRouter(router)`, `setSamples(samples)`, and `setField(field)`.
- `tools/wifi-sampler/` provides `sampleRssi()` plus Linux CLI/server entry points. The app should retain manual entry when local capture is unavailable.

## Thermal scenario and output

`thermal-model/index.js` exports pure `simulate(floorplan, scenario = {})`. Current scenario inputs and defaults:

```json
{
  "outside_temp_c": 8,
  "initial_temp_c": 16,
  "duration_min": 60,
  "step_min": 5,
  "infiltration_ach": 0.5,
  "heaters": [{ "id": "heater-1", "room_id": "hall", "position_m": [2, 2], "watts": 1500 }],
  "room_overrides": { "hall": { "initial_temp_c": 16, "thermal_mass_j_k": 1000000 } }
}
```

The result is `{method:'lumped-rc', times_s, rooms, assumptions}`. Each room includes `area_m2`, `volume_m3`, `temps_c` aligned with `times_s` (including t=0), `final_temp_c`, and `heater_energy_kwh` for the full simulated duration. `thermal_mass_j_k` can be supplied per room or in `room_overrides`; otherwise the model uses its documented default. Wall/opening U-values come from `materials` or the model's defaults. The UI's kWh display is prorated to the currently selected time because heater output is constant.

This is a simplified one-temperature-node-per-room model using wall conduction, inter-room transfer, infiltration, and constant heater power. It excludes airflow/CFD, solar and occupancy gains, and thermostat control. The model returns assumptions/exclusions; the current UI shows the method and key exclusions, heater energy, per-room temperatures, and a time slider. Treat results as approximate, not measured or calibrated.

## Planned thermal CFD contract

The user approved a native coarse 3D thermal lattice-Boltzmann model. Kimi owns `thermal-cfd/**`; Claude owns the Worker and viewer integration in `src/**`. The existing lumped-RC model remains available as a fast comparison. This is an approved direction, not a claim that the solver is already implemented or validated.

V1 targets Boussinesq buoyancy, D3Q19 flow, and D3Q7 temperature on a coarse voxelized single-floor domain. The current viewer proposal exchanges one grid `{origin_m:[x0,z0], cell_m, nx, nz, ny, height_m, cell_type}` where `cell_type` is 0=air, 1=solid wall, 2=heater source; and frames `{time_s, temperature_c:Float32Array(n), velocity_m_s:Float32Array(3*n)}`. Flatten indices x-fastest: `((iy*nz)+iz)*nx+ix`. Cell centres use plan `[x,z]` and vertical `y`; plan `[x,z]` maps to world `[x,y,-z]`, while velocity components are world XYZ. Solid-cell frame values are ignored by the viewer.

The Worker proposal accepts `run` with the floorplan and scenario (outdoor/initial temperatures, duration, output interval, heaters, and cell size), and `cancel`; it streams grid/frame/progress/done/error messages and transfers large arrays. The exact schema, grid sizing, output interval ownership, and thermal boundary treatment remain subject to solver/viewer confirmation in `../hackathon-2026-11/CHANNEL.md`. Keep the first viewer slice to temperature and velocity. No explicit solid wall mesh, solar gains, or turbulence model are in the proposed v1. Validate against a differentially heated cavity benchmark and a 3D cubic-cavity case before interpreting house-plan output.
