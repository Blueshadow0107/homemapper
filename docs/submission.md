# Submission text

## Demo video

[`video/demo.mp4`](../video/demo.mp4) — 83 s, open captions, no voiceover; one synthetic plan from upload to analysis.

## One-liner

Home Comfort Twin lets planners and designers compare router placement and heating on a floorplan in the earliest stages of house design, before anything is built.

## Short description

Upload or draw a floorplan, check it in 2D, then inspect it as an editable 3D shell. Move a single router to see an **estimated** Wi-Fi field, add radiators to get **quantitative** room-by-room temperature estimates over time, and run a **qualitative** 3D airflow view. Optional real Wi-Fi readings are kept separate from the estimate. Everything runs locally; the only network call is the optional AI plan draft, which sends the image you choose to the OpenAI API after you press a button.

## Who it is for

Planners and designers working on a new house or renovation before construction, when moving a router or a radiator is still free.

## What is real, and what is not

- Wi-Fi is a model estimate, not a survey. Heating is a lumped room model, not a certified energy calculation. Airflow is qualitative and uncalibrated.
- AI floorplan drafts are marked unverified until the user checks them, and need correction on dense plans.

## Built with

Vite, Three.js, the OpenAI API (vision model for the optional plan draft), and procedurally generated furniture. Solo project, built in one day with Claude, Kimi and Codex as AI coding agents. See the README for credits.

## Next

Windows and doors placed in the editor, multiple floors, and furniture that interacts with heat and airflow.
