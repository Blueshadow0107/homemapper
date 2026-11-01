# Product brief

## Working description

Home Comfort Twin turns a floorplan into an editable 3D shell, estimates Wi-Fi coverage from a router's position and intervening walls, and simulates approximate room temperatures under a heating scenario. People can optionally collect readings at marked spots to compare the Wi-Fi estimate with reality.

## First audience and problem

The first audience is someone setting up Wi-Fi in a home or venue who wants to reason about coverage before moving equipment repeatedly. The hackathon demo maps a schematic venue; it is a prototype for comparative planning, not a site survey.

## Core journey

1. Load the schematic plan or import `floorplan.json`, then inspect the 2D plan and 3D shell.
2. Correct the plan in the editor: move shared corners, add/delete walls, add rectangular rooms, rename rooms, set wall material/exposure, set ceiling height, and scale from a known wall length.
3. Place or move one router in the plan and see a predicted Wi-Fi field update from distance and wall attenuation.
4. Optionally check a location: capture and save connected-network RSSI in one click, or enter dBm manually, then compare the reading with the nearby prediction.

## Core demo requirements

- The 3D shell remains central and can be orbited, viewed from above, and cut away.
- Router placement drives the predicted field; no seeded readings are required to see it.
- Users can choose the router band and optionally override transmit power; spot checks with a different band are flagged before comparing values.
- Predicted cells are labelled as estimates. Optional measured/manual checks remain distinct and show the difference from the nearby prediction.
- Large estimate/readout differences can reflect uncalibrated model defaults or schematic geometry; the delta is diagnostic, not proof of a specific cause.
- The starting Wi-Fi defaults are 17 dBm transmit power and path-loss exponent 3; users should calibrate to their actual router and layout.
- Geometry and wall materials affect prediction; JSON import/export and plan sanity warnings support review and correction.
- An uploaded floorplan can be sent by explicit user action to OpenAI through a local proxy; its result is marked unverified and editable before use.
- Manual RSSI entry remains available when local Linux capture is unavailable.

## API use

The OpenAI image-to-plan pipeline is implemented: a local proxy sends a user-selected image for structured geometry extraction, then the app transforms it to editable plan JSON with scale warnings and a source-image underlay. The user must review and correct the draft. A generated synthetic two-room plan passed through both the real API and browser upload flow; the UI showed the unverified-draft banner and flagged its guessed scale. This verifies the path, not extraction quality on arbitrary real drawings. The API does not produce signal measurements or the Wi-Fi field.

If the image has no printed overall width, the draft uses a clearly warned 12 m longest-side scale guess. The user should set scale from a known wall length before relying on measurements or simulations.

## Scope boundaries

### Current slice

- One floor and simple wall geometry, editable in the 2D plan editor.
- 3D shell, router placement, and router-driven Wi-Fi prediction.
- Optional local RSSI capture plus manual entry for spot checks.
- User-triggered image-to-plan draft through the local OpenAI proxy. A synthetic plan has passed both the real API and browser upload path; arbitrary floorplan accuracy still needs user-plan review.
- Lumped-RC room heating simulation with heater placement, outdoor-temperature input, per-room temperature tint/labels, and a time slider.

### Approved next thermal layer

- Add a native coarse 3D Boussinesq thermal-LBM solver in a Worker, with velocity and temperature fields, heater sources, and material-aware heat-loss boundaries. Keep the lumped-RC model as a fast comparison. The CFD model is a prototype, not a building-grade prediction.

### Later work

- Improve thermal calibration and add richer building inputs.
- Multi-storey buildings, CAD/DXF import, detailed furniture, and calibrated or survey-grade predictions.

## Demo story

“Upload a floorplan image to get an editable, unverified draft, correct its geometry and scale, then inspect the 3D shell. Place the router to see approximate Wi-Fi coverage, or set a heating scenario to compare modelled room temperatures over time. Spot readings can check the Wi-Fi estimate.”
