# Judge demo video

Target runtime: 80–85 seconds (hard limit: 90 seconds).

## Story

Show one practical journey: review a floorplan in 2D, inspect it in 3D, then use the twin to reason about router placement and heating. Keep the bundled schematic venue plan on screen for the core demo so the result is repeatable. If showing image import, use a synthetic floorplan and leave its unverified status visible.

| Time | Screen | Voiceover |
|---|---|---|
| 0:00–0:07 | Start on **1 2D plan · review & edit**. Show the plan and the Upload plan image action. | “Before rearranging a home or venue to fix dead Wi-Fi or uneven heating, it helps to see how the space might behave.” |
| 0:07–0:19 | Briefly show upload, crop, and scale; return to the bundled plan. If using an imported synthetic plan, show **Review in 2D plan** and keep **AI draft · not verified** visible. | “A floorplan image can create an AI draft, but the draft is not verified. I review and correct it in 2D before relying on the layout.” |
| 0:19–0:31 | Use **Looks right: inspect in 3D →**. Orbit the shell; show the plan's room and wall counts. | “Once the 2D plan looks right, I inspect the same rooms in 3D.” |
| 0:31–0:48 | In **Wi-Fi**, click **Place router** and show the estimated field. Briefly show **Add a reading**. Keep the **Estimated** pill visible. | “I can try router positions and see estimated Wi-Fi coverage change with distance and walls. It is not a survey; real spot readings are kept separate.” |
| 0:48–1:04 | In **Heating**, click **Add radiator**, run/scrub the timeline, and show room temperatures. Keep **Quantitative estimate** visible. | “Heating gives an approximate room-temperature estimate over time under the selected scenario assumptions.” |
| 1:04–1:14 | Briefly show **Airflow**, its **Qualitative** pill, and the caveat. | “Airflow shows relative circulation and warmth qualitatively. Heating is the only view with quantitative temperature estimates.” |
| 1:14–1:24 | Show Codex contribution note, then end on the full 3D view and project name. | “Codex helped us test real floorplan drafts and catch misleading AI location hints. We kept text suggestions and left geometry for people to verify. That’s HomeMapper.” |

## Recording notes

- Aim for 80–85 seconds; trim pauses rather than speeding up the explanation.
- Record the local app with the bundled schematic plan. Follow the numbered **2D plan → 3D view** path, and keep cursor movement deliberate.
- If demonstrating image import, use a synthetic plan, show the crop and scale step, and keep the unverified warning visible. Do not use a private home plan in a public video.
- Use the UI labels **Estimated**, **Quantitative estimate**, and **Qualitative** in the recording. Avoid presenting Wi-Fi as measured or calibrated. Keep the Airflow caveat visible and do not compare its colours to Heating values.
- End with the public repository URL once it is ready and accessible without a sign-in.

## Claims to keep accurate

- Floorplan extraction creates a draft that needs human review; quality varies with the source image.
- Wi-Fi coverage is a simplified estimate; spot checks are separate readings.
- Heating is an approximate room-level model, not a calibrated building-energy prediction.
- Airflow is qualitative and is not energy-equivalent to Heating.
- The hackathon event page lists submissions closing at 17:00 and final demos at 18:00; it does not publish judging criteria.

## Captions-only cut

`video/assemble.mjs` builds a voiceless version of this script (open captions, 83 s) from clips recorded by `video/capture.mjs`; the voiceover table above remains the script for a narrated take.
