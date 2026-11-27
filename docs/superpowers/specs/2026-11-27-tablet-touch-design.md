# Tablet play: touch controls + no-lag performance

## Intent
Play on a tablet that has a keyboard and a touchscreen but no mouse. Top priority
(user): it must not lag on the tablet. Second: touch controls.

## Goals
- Smooth frame rate on a tablet GPU (target 60 fps, never long stalls).
- Right-hand touch: drag empty space to look; fire button fires and also aims while dragged; ADS toggle button.
- Left-hand floating joystick (appears where touched, hidden otherwise); push to edge = sprint.
- Small buttons: reload, jump, crouch, weapon swap, pause.
- Keyboard keeps working alongside touch.

## Non-goals
Control customisation, aim-assist / auto-fire, real-device testing (user does that).

## Approaches
- **Touch:** feed touch into `src/core/input.js` (look/fire/ads/move) so player & weapon code stay untouched — chosen. Rewriting player input per subsystem was rejected (touches many owners).
- **Performance:** (a) static "mobile" preset only, (b) preset + runtime dynamic resolution, (c) also cut world geometry. Chosen: (a)+(b) now, (c) only if measurement says geometry is the bottleneck.

## Design
- New `mobile` quality preset: renderScale ~0.6, pixel ratio capped at 1, no TAA/GTAO/SSR/volumetrics/motion blur/DOF/contact shadows, small shadow map, 2 cascades, low particle/decal budgets.
- Touch devices default to `mobile` (URL `?q=` still overrides).
- Dynamic resolution: watch frame time; lower render scale in steps when slow, raise when there's headroom (with hysteresis so it doesn't thrash).
- On touch devices: no pointer-lock requirement, no auto-pause on lock loss.
- Small FPS readout (toggle) so the user can report real-device numbers.
- Verify in headless Chromium with tablet emulation (touch works, no errors, screenshots). Real perf only measurable on the device.
