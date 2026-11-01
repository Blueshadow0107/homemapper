# Home Comfort Twin

A local-first web app that turns a floorplan into an editable 3D building shell, then lets you reason about it:

- **Wi-Fi: estimated.** Signal strength from one router's position, distance and the walls in between. Optional real RSSI "spot checks" are kept separate from the estimate.
- **Heating: the only quantitative temperature view.** A lumped room-by-room model over time for the radiators you place.
- **Airflow: qualitative.** A fast 3D lattice-Boltzmann solver showing relative circulation and warmth. It is uncalibrated: use it for direction and shape, not for how warm a room gets, and do not compare its colours with the Heating values.

None of the results is survey-grade or a building-energy calculation.

The bundled plan (`data/demo-floorplan.json`) is a schematic with illustrative dimensions, not a real venue. Any plan you upload or draw is only as accurate as you make it.

## Quick start

Requires Node.js 20.19+ (Vite 7).

```sh
npm install
npm run dev          # http://127.0.0.1:5173 (Vite picks the next free port if busy)
npm test
npm run build
```

### Optional: draft a plan from an image (OpenAI API)

The image-to-plan draft uses the OpenAI API through a small local proxy, so the key never reaches the browser.

```sh
# in a terminal where OPENAI_API_KEY is already set (never put it in the repo or a .env you commit)
npm run draft-server
```

- Listens on `127.0.0.1:5176` only, checks Host/Origin, caps uploads at about 8 MB, and returns strict-schema JSON.
- Default vision model is `gpt-5.5`; change it with `OPENAI_MODEL=...` or per run with `?model=...` in the app URL (ids are validated).
- Nothing is sent until you press **Read plan** in the upload dialog. **Pressing it sends the (cropped) image you chose to OpenAI.** Do not upload plans you are not allowed to share.
- A draft is always marked **AI draft · unverified** until you press "I have checked it". **Check draft against image** asks for a text-only second opinion, and **Fix these issues** re-reads the plan using those findings (Undo restores the previous draft).
- No API key? `npm run draft-server:mock` serves canned drafts for trying the flow.

### Optional: real Wi-Fi readings

```sh
node tools/wifi-sampler/server.js
```

The sampler runs on `127.0.0.1:5175` and uses the Linux `iw` tool on a connected interface. Without it, type a dBm value by hand.

## Using it

1. **2D plan (review & edit)** — upload a plan image, import/draw a plan, fix walls, rooms, scale (set a wall's real length), ceiling height, and place furniture and radiators. Then press **Looks right: inspect in 3D →**.
2. **3D view (inspect & analyse)**
   - **Wi-Fi** — *Place router* moves the single source; *Add a reading* records a real or typed RSSI at a spot. Band (2.4 / 5 / 6 GHz) and transmit power are under *Model settings*.
   - **Heating** — *Add radiator* then click a wall; scrub the time slider; *Scenario settings* has outside temperature and default radiator power.
   - **Airflow** — *Run* simulates the same radiators in 3D; scrub time and slice height.

### Rebuilding the demo video (optional)

With `npm run dev` on port 5174 (or `APP=...`) and, for the upload shot, the draft server running:

```sh
node video/capture.mjs      # headless Brave/Chromium drives the app, writes one clip per scene to video/out/
node video/assemble.mjs     # open-captioned, voiceless MP4 -> video/out/home-comfort-twin-demo.mp4 (under 90 s)
```

Needs ffmpeg and a Chromium-based browser named `brave-browser` on PATH. The upload shot uses the generated synthetic plan, never a real one.

## Repository layout

| Path | What |
|---|---|
| `src/` | Viewer (Three.js), 2D editor, plan operations/validation, AI-draft converter, upload dialog, CFD client/layer |
| `server/` | Local OpenAI proxy (`index.js`) |
| `wifi-model/` | Wi-Fi prediction (log-distance path loss with per-wall attenuation) |
| `tools/wifi-sampler/` | Local RSSI sampler |
| `thermal-model/` | Lumped-RC room heating model |
| `thermal-cfd/` | 3D lattice-Boltzmann airflow solver (runs in a Web Worker) |
| `assets/furniture/` | Furniture catalog and its generator |
| `data/` | Bundled schematic floorplan |
| `docs/` | [Product brief](docs/product-brief.md), [architecture](docs/architecture.md), [data contract](docs/data-contract.md) |
| `video/` | Scripts that capture and assemble the demo video (`capture.mjs`, `make-plan.mjs`, `assemble.mjs`; outputs are git-ignored) |
| `test/` | Node tests; the model folders carry their own `*.test.mjs` |

## Built with, and what is original

**Third-party software (installed from npm, not vendored):**

- [Vite](https://vite.dev/) 7 — dev server and build (MIT).
- [Three.js](https://threejs.org/) 0.181 — 3D rendering, including its `OrbitControls` addon (MIT).
- [OpenAI API](https://platform.openai.com/) — vision model for the optional plan draft and review. Used over HTTPS from the local proxy only.
- [DM Sans](https://fonts.google.com/specimen/DM+Sans) and [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) (SIL Open Font License) — loaded at runtime from Google Fonts by `src/styles.css`, so a fresh page load needs network access for the fonts (the app falls back to system fonts without it).

Runtime dependencies are only `three`; `vite` is a dev dependency. Everything else is Node and browser built-ins.

**Written in this repository (no third-party code, templates or models were copied in):**

- The editor, viewer, plan format and converters in `src/`, and the proxy in `server/`.
- The Wi-Fi, heating and airflow models. They use standard, published ideas (log-distance path loss with wall loss, lumped thermal resistance/capacitance, D3Q19 flow + D3Q7 temperature lattice-Boltzmann with a Boussinesq buoyancy term) implemented natively here; no external solver or library is bundled.
- **Furniture and room assets are generated, not downloaded.** `assets/furniture/generate.mjs` builds every piece procedurally from boxes, cylinders and spheres into `assets/furniture/catalog.json`. There are no external meshes, textures, icons or images in the repo. `preview/furniture.html` is a viewer for that catalog.
- The demo floorplan is hand-written schematic data.

**How it was built:** during a one-day hackathon (2026-11-01) by a person working with AI coding agents (Claude, Kimi and Codex). The agents wrote and reviewed much of the code; design and physics decisions were made by the person. The agent hand-off log is not part of this repo.

## Data, privacy and what stays out of Git

- Floorplan images you upload, real plans, screenshots of them, and recorded demo output (`video/out/`, generated PNG/SVG/log files in `video/`) are **not** committed. `.gitignore` covers `video/out/`, `video/*.png`, `video/*.svg`, `video/*.log`, `.env*` and `dist/`.
- The demo video's upload shot uses a fully synthetic plan generated by `video/make-plan.mjs`, not a real or third-party drawing.
- API keys live only in the environment of the terminal that runs `npm run draft-server`. They are never written to the repo, the browser or logs.
- The app and the Wi-Fi sampler bind to loopback only.

## Limitations

- Single storey, rectilinear-friendly plans. The Wi-Fi and Heating models read `openings` (doors/windows) from plan JSON, but the editor has no door/window tool yet and the airflow solver ignores them.
- AI drafts misplace or miss rooms on dense plans; always compare with the source image and fix by hand.
- The Wi-Fi model defaults (17 dBm, path-loss exponent 3) are rough starting values; compare spot readings on the same band before reading anything into the differences.
- The Heating model has no sun, wind or thermostat. The Airflow solver is not energy-equivalent to it.

## Licence

No licence file has been added yet, so the code is all-rights-reserved by default. Add one before anyone is invited to reuse it.
