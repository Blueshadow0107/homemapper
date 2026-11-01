# Product brief

## Working description

Home Comfort Twin turns a floorplan into an editable 3D shell, then lets you reason about it: an **estimated** Wi-Fi field from one router, a **quantitative** room-by-room heating estimate, and a **qualitative** airflow view. People can optionally take Wi-Fi spot readings to compare the estimate with reality.

## First audience and problem

Planners and designers in the earliest stages of house design, comparing heating and router placement before construction so options can be reasoned about before they are expensive to change. The hackathon demo uses a schematic and a synthetic plan; this is a prototype for comparative planning, not a site survey or an energy audit.

## Core journey

The app has two numbered steps.

1. **2D plan (review & edit).** Load the bundled schematic, import `floorplan.json`, draw a plan, or upload a plan image for an AI draft. Fix corners, walls, rooms, materials, ceiling height and scale (set a wall's real length), and place furniture. AI drafts show **AI draft · unverified** until the user presses "I have checked it". "Check draft against image" gives text-only hints and "Fix these issues" re-reads the plan using them. **Looks right: inspect in 3D →** moves on.
2. **3D view (inspect & analyse).** Orbit, cut away walls or view from above, then use one of three layers:
   - **Wi-Fi** (pill *Estimated*): *Place router* moves the single source; *Add a reading* records a real or typed RSSI at a spot.
   - **Heating** (pill *Quantitative estimate*): *Add radiator* on a wall, *Remove all*, scrub time, set outside temperature and radiator power.
   - **Airflow** (pill *Qualitative*): run the 3D solver and scrub time and slice height.

## Claims we make, and do not make

- Wi-Fi is a model estimate from router position, distance and walls. It is not a survey. Spot readings are kept separate and flagged when their band differs from the model's.
- Heating is the only view that gives temperatures. It is a lumped room model (conduction, infiltration, constant radiator power; no sun, wind or thermostat), not a calibrated building-energy prediction.
- Airflow is qualitative. The solver is uncalibrated: colours show relative warmth and arrows show direction, never absolute temperature, and its colours must not be compared with Heating values.
- AI drafts are drafts. Extraction quality varies with the image and misplaced or missing rooms are expected on dense plans.

## Core demo requirements

- The 3D shell is central and can be orbited, viewed from above and cut away.
- Router placement drives the estimated field; no seeded readings are needed.
- Router band (2.4/5/6 GHz) and transmit power are adjustable; defaults are 17 dBm and path-loss exponent 3 (rough starting values).
- Radiators are furniture with a heat source: placing one adds a heater to the heating and airflow scenarios.
- Furniture is placed in 2D, shown in 3D, and solid pieces block air in the Airflow solver.
- Manual RSSI entry works when local Linux capture is unavailable.

## API use

The OpenAI API is used only for the optional plan draft and its review/fix passes, through a loopback proxy that holds the key in its environment. The default vision model is `gpt-5.5`. Pressing **Read plan** sends the cropped image to OpenAI; nothing is sent before that. The API never produces signal measurements, the Wi-Fi field or any temperature.

If an image has no printed overall width, the user can type the real width in the upload dialog; otherwise the draft uses a clearly warned 12 m longest-side guess and the user must set scale from a known wall.

## Scope boundaries

### Current slice

- One storey, simple wall geometry, editable in 2D; 3D shell.
- Router-driven Wi-Fi estimate with optional spot readings.
- Lumped-RC heating with radiators, outdoor temperature and a time slider.
- Qualitative 3D airflow (lattice-Boltzmann) in a Web Worker.
- Procedurally generated furniture catalog (18 pieces).
- AI draft, review and fix through the local proxy.

### Later work

- Calibration of the airflow solver (so it could be compared with Heating) and richer building inputs.
- Windows and doors placed in the editor, multiple floors, and furniture that interacts with heat and airflow (beyond blocking air and acting as radiators).
- CAD/DXF import, calibrated or survey-grade predictions.

## Demo story

Review a floorplan in 2D, inspect it in 3D, then use the twin to reason about router placement and heating. See [demo-video.md](demo-video.md) for the script.
