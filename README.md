# Home Comfort Twin

A local-first tool for turning a floorplan into an editable 3D building shell, estimating Wi-Fi strength from a router's position and the walls in the plan, and simulating approximate room temperatures under a heating scenario. Optional readings let you spot-check the Wi-Fi prediction.

## First demo journey

1. Load the schematic plan or import a `floorplan.json` and inspect it in the 2D editor and 3D view.
2. Correct room/wall geometry, materials, ceiling height, and scale from a known wall length.
3. Place or move one router and see its predicted signal field update.
4. Optionally check a spot by capturing and saving Wi-Fi RSSI in one action, or enter dBm manually.

The Wi-Fi controls let you select 2.4 or 5 GHz and optionally override router transmit power. A warning appears if a spot reading's band differs from the model band.

To draft a plan from an image, start the local proxy with `OPENAI_API_KEY` set in that shell using `npm run draft-server`, then run the Vite app. Upload is user-triggered; the result is marked as an unverified draft and opens in the editor for correction. Mock mode is available with `npm run draft-server:mock`.

The starter floorplan is schematic. It is not the hackathon venue plan, and its dimensions are illustrative.

## Run locally

```sh
npm install
npm run dev
```

For image drafting, run the proxy in another terminal. The real server needs `OPENAI_API_KEY` set in that terminal; never put it in the repo or browser.

```sh
npm run draft-server
```

To exercise the mock draft flow without an API key, use `npm run draft-server:mock` instead. For live Wi-Fi capture, run `node tools/wifi-sampler/server.js` in a third terminal; otherwise use manual dBm entry.

The local Wi-Fi sampler uses Linux wireless tools and a connected interface. Manual readings remain available when sampling is unavailable.

## Use the heating view

Switch to **Heating**, choose **Add heater**, and click inside a room. Set heater power and outside temperature, then scrub the time slider to see modelled room temperatures and heater energy. With no heaters placed, rooms cool toward the outside temperature. The model is a simplified estimate, not an energy audit.

## Project notes

- 3D building shell is part of the core experience.
- The primary signal map is a simplified prediction from router distance and wall attenuation, not a site survey. Spot-check readings are separate from the estimate.
- Current model defaults are 17 dBm transmit power and path-loss exponent 3; these are rough starting values. Check readings on the same band and set the router's actual position/plan before interpreting deltas.
- Treat predicted-vs-measured differences cautiously until the plan, router settings, and model defaults are calibrated to the space.
- The 2D plan editor supports geometry edits, scale correction, undo, and JSON import/export. A real OpenAI request and browser upload both worked with a synthetic two-room plan; the generated draft correctly showed the unverified banner and warned that its 12 m scale was a guess. Review and rescale real drawings before relying on them.
- A deterministic per-room thermal model is implemented with a viewer layer for placing heaters, adjusting outdoor temperature, and scrubbing modelled room temperatures over time.
- A native spatial thermal-CFD mode is approved and under development; the current room model remains the quick comparison.
- `data/demo-floorplan.json` is schematic, with illustrative dimensions. Replace it with a reviewed plan before using the map for a real space.

See [the product brief](docs/product-brief.md), [architecture](docs/architecture.md), and [data contract](docs/data-contract.md).
