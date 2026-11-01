# HomeMapper

## Product scope

- A floorplan becomes an editable 3D building shell; 3D is a core feature, not a stretch goal.
- Current slice: editable single-floor plan to 3D shell, router-based Wi-Fi prediction, optional measured RSSI spot checks, user-triggered OpenAI plan drafting, and lumped-RC heating mode.
- Approved next layer: native 3D thermal LBM CFD (Boussinesq, D3Q19 flow + D3Q7 temperature), with the RC model retained as a fast comparison.
- Keep measured signal values distinct from estimates. Neither current Wi-Fi nor thermal results are survey-grade/calibrated.
- Use the sibling `../hackathon-2026-11/CHANNEL.md` for Claude/Kimi/Codex handoffs and file claims.

## Ownership

- Claude owns `src/**`, `index.html`, `data/demo-floorplan.json`, and `server/**` (viewer/editor and image-draft proxy).
- Kimi owns `wifi-model/**`, `tools/wifi-sampler/**`, `thermal-model/**`, and `thermal-cfd/**` (Wi-Fi and thermal models/sampler).
- Codex owns `README.md`, `docs/**`, this file, and the workspace project map.
- Check the shared channel before touching files outside your claim.

## Implementation notes

- Web stack: Vite + Three.js; plan coordinates are metre-based `[x,z]`, mapped to world `[x,0,-z]`. See `docs/data-contract.md`.
- Keep the app local-first. Wi-Fi reads are local; manual signal entry remains available.
- Do not put API keys or user floorplan uploads in the repository.
- No source edits until the owning agent has a claim in the shared channel.
