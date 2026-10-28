# NEE to NBE animation

Question: how does the annual carbon balance of a site-year change when the carbon of the management (harvest, grazing, thinning, organic inputs) is added to NEE? The video morphs carbon-space Figure 4 (`analysis/carbon-space/figures/4-carbon-space-forest.svg`: annual TER against annual GPP, the vertical distance from the 1:1 line is NEE) into NBE Figure 1 (`analysis/net-biome-exchange/figures/1-nbe-carbon-space.svg`: annual carbon out = TER + C_out − C_in against GPP, the distance from the 1:1 line is NBE).

Data: `analysis/net-biome-exchange/results.json` (the 20 site-years of NBE Figure 1) and `analysis/carbon-space/results.json` (Maktau 2019, which has no NBE). The script stops with exit code 3 when GPP or TER differ between the two files. The style (colours, markers, label offsets, fonts) is copied from the two dive scripts; the dive scripts are not imported and do not change.

Run (from the repository root; `uv` installs matplotlib, numpy and the `imageio-ffmpeg` wheel, which bundles a static ffmpeg with libx264):

```
uv run analysis/net-biome-exchange/animation/make-animation.py
```

Options: `--out <folder>` (default `data/NEE-NBE-animation/`, not in git), `--fps 60`, `--width 1080` (4:3, a multiple of 8), `--stills-only` (only the three PNG stills, about 1 s), `--frames` (also every frame as PNG to `analysis/net-biome-exchange/output/animation/frames/`, not in git), `--repo <folder>` (the repository root; default: from the script path). A system `ffmpeg` on `PATH` is used when it exists. The full run takes about 1 to 2 minutes (810 frames; identical hold frames are drawn once). Exit codes: 0 done, 1 render or ffmpeg error, 2 bad option, 3 data check failed.

Output: 1080 × 810 px (4:3), 60 fps, H.264 (yuv420p, CRF 18), no audio, white background, legend on the right.

| File | Content | Timeline | Duration |
|---|---|---|---|
| `1-nee.mp4` | Still: annual TER against annual GPP, Figure 4 state (y axis 400 to 1600). | 0.0 to 3.0 s | 3.0 s |
| `2-nee-to-nbe.mp4` | Hold 1.0 s. The agricultural site-years move from y = TER to y = carbon out (2.5 s). A grey shift line grows from the TER tick. Class B markers turn hollow and get the low-to-high bar. Maktau 2019 fades out. The y label and the guide labels change from NEE to NBE. The Class legend fades in. Hold 1.0 s. Hyytiälä 2020 stays; the axes do not change. | 3.0 to 7.5 s | 4.5 s |
| `3-thinning.mp4` | Hold 1.0 s. Hyytiälä 2020 (thinning) moves to carbon out 3393, and the y axis grows to 3600 (3.0 s). The y ticks go from the 200 step to the 400 step. Hold 2.0 s. | 7.5 to 13.5 s | 6.0 s |
| `nee-nbe-animation.mp4` | The three clips in one file (cuts at 3.0 s and 7.5 s). | 0.0 to 13.5 s | 13.5 s |
| `1-nee.png`, `2-nbe.png`, `3-nbe-thinning.png` | The still frames at 0.0 s, 7.5 s and 13.5 s. | | |
| `timeline.json` | The clips with start and end seconds and frame numbers, fps, size, the ffmpeg version. | | |

Each clip starts and ends on a still frame, and the last frame of a clip is the first frame of the next clip. The motion uses smoothstep easing (3t² − 2t³).

The video differs from the two figures, because its canvas is denser (the plot is 112 × 115 mm; the legend column takes the rest). The y axis starts at 400 from the first frame (Qvidja 2023 moves to 545 in step 2). The guide labels sit at the right axis edge below the line. "net source" is in two lines. "net sink" sits at axes fraction 0.02 from the bottom (Figure 4: 0.03, Figure 1: 0.01). The labels "2023 grass (failed)" and "2019 (pre-thinning)" are one line (Figure 4 wraps them). In step 1, "2023 grass (failed)" sits below its marker with a short leader line, because above the marker it would touch the Särkisuo square and the "2025 faba bean" label. It moves to its Figure 1 place above the marker in step 2. "2020 (thinning)" is 4 points higher in steps 1 and 2. Four labels slide to free places during step 3 (`LABEL_OFFSETS_FINAL`); the Qvidja 2024 label fades out and in. A label whose side changes moves on an arc around its marker. The legend has no site emojis: matplotlib cannot load the Noto Color Emoji font (a bitmap font).

## Use in PowerPoint

1. Insert → Video → This Device (Windows) or Insert → Video → Movie from File (macOS), one clip per slide or all three on one slide.
2. In Playback, set Start to On Click (or In Click Sequence). Do not loop.
3. Put the clips in the order 1, 2, 3. Because each clip ends on the still frame that the next one begins with, the three clips look like one animation with a pause at each cut: click to play step 1 (a 3 s still), click again for step 2, click again for step 3.
4. For a single video without pauses, use `nee-nbe-animation.mp4`. For a slide without video, use the PNG stills.

Develop: `uvx ruff@0.17.2 format analysis/net-biome-exchange/animation && uvx ruff@0.17.2 check analysis/net-biome-exchange/animation`, `uv run --with pyright==1.1.414 --with pytest==9.1.1 --with-requirements analysis/net-biome-exchange/animation/make-animation.py pyright analysis/net-biome-exchange/animation`, `uv run --with pytest==9.1.1 --with-requirements analysis/net-biome-exchange/animation/make-animation.py pytest analysis/net-biome-exchange/animation/`. The tests do not run ffmpeg.
