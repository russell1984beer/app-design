# Drone garden survey and design app (working name: Plotwise)

Project brief for Claude Code. Read this first in every session.

## What we are building
A mobile app that flies a DJI drone automatically over a property, turns the photos into a
measured survey (dimensions, levels, contours), and gives the owner a garden design tool,
roof inspection and material quantities. The owner (non-developer) supervises flights and
tests builds on real devices.

The clickable prototype (`prototype/`, to be added) shows the
intended screens and behaviour. Treat it as the UX reference, not as production code.
Note: "TerraScan" clashes with existing Terrasolid software, so do not use that name.

## Hardware
- Drone: DJI Mini 4 Pro with the **RC-N2** controller (MSDK does not support it with DJI RC 2).
- Flight phone: Samsung Galaxy S22 (Android), dedicated to the drone.
- Owner also has an iPad (iOS).
- Development machine: Windows PC (no Mac).
- Future production drone: DJI Matrice 4E (RTK) for contractor-grade accuracy.

## Platform decisions
- DJI Mobile SDK v5 is **Android only**, so flight control (Plan and Scan) runs on Android only.
- Everything else (survey viewing, measuring, design, sun/shade, plants, roof reports,
  materials) must work on **both iOS and Android**.
- Use one cross-platform codebase (React Native with Expo, or Flutter) with a native
  Android module wrapping DJI MSDK v5.
- iOS builds happen in the cloud (e.g. Expo EAS Build) and go to the iPad via TestFlight.
- Scans flown on Android sync to the cloud and appear on iOS.

## Secrets
- The DJI App Key is tied to the package name. Keep it in an untracked local config file
  (e.g. `local.properties` / `.env`), list that file in `.gitignore`, never commit it,
  never print it in logs.

## Flight safety requirements (non-negotiable)
- A human remote pilot supervises every flight and can take over or trigger Return Home
  at any moment (UK CAA rules). The app never removes that control.
- **Home point**: user-set on the map; drone returns and lands there.
- **Signal loss**: configure the drone's own failsafe before take-off (default: return to
  home and land; options: hover, land). Must work with no app or internet connection.
- **Return height**: user-set (default 30 m), clears roof (~8.5 m), trees and aerials.
  Must be at least tallest obstacle + 10 m and at most 120 m (UK limit).
- **Low battery**: automatic return with reserve for the trip, extra reserve into headwind.
  Lands with at least 20% (default). Uses the measured drain rate if it is worse than expected.
- **Wind**: pre-flight check against forecast (Met Office) blocks take-off if gusts exceed
  the user's limit (default 8 m/s, max 10.5 m/s for Mini 4 Pro). In flight, monitor the
  drone's wind warnings/estimate; if over the limit, pause the scan and return home.
- Resume a scan from where it stopped, keeping photos already taken.
- Geofence to the property plus a margin (default 5 m); pre-flight no-fly-zone check.
- Test all flight code in DJI's simulator before any real flight; first real flights low
  and short in the owner's garden.

## Code so far
- `packages/flight-core/` (TypeScript, no runtime dependencies, needs Node 22.18+):
  - `planner.ts`: grid mission over a drawn boundary (height/overlap), angled orbit for walls/roof.
  - `safety.ts`: safety settings and defaults, pre-flight checks, return-home battery maths.
  - `bridge.ts`: the `DroneBridge` interface the Android module must implement.
  - `flight-session.ts`: `FlightSession`, the phone-side flight controller.
  - `sim-drone.ts`: `SimDrone`, a simulated drone including its own failsafes.
  - Run `npm test` there and keep it green; `npm run typecheck` checks types.
  - End-to-end tests in `test/flight.test.ts` cover normal scans, signal loss, gusts,
    low battery (incl. headwind and a fast-draining battery), resume, the pilot's return
    button, the RC return button, pilot takeover, geofence and camera faults.
  - All planning and safety logic belongs here, not in the Android module.
- The clickable prototype is not in this repo yet. Rename it without the address before adding.
- The Android module and app screens must be built on the owner's Windows PC (Android SDK,
  Gradle and the DJI SDK are not set up in the cloud workspace).
- Next: the Android flight module, see `docs/android-flight-module.md` (to be written). It
  must pass the same scenarios as `test/flight.test.ts` in DJI's simulator.

## Build phases
1. **Flight app (Android)**: connect via MSDK, home point, automatic grid mission over a
   drawn boundary (height/overlap settings), angled orbit for walls/roof, live telemetry,
   all failsafes above, photo capture, pre-flight checklist.
2. **Survey**: upload photos, photogrammetry (e.g. OpenDroneMap), orthomosaic, terrain
   model, contours, slope, tap-to-measure distance/area/levels.
3. **Design tool** (iOS + Android): styles, drag/resize/rotate, typed dimensions, materials,
   draw custom shapes with editable corners, existing features, undo/redo, snap,
   sun and shade simulation, plant recommendations, materials and cost list.
4. **Roof inspection**: close-orbit flight over the user's half of a semi-detached roof,
   then automatic damage detection (needs a model trained on labelled roof photos).

## Test property
The owner's own semi-detached house. The address and title number are in `CLAUDE.local.md`
on the owner's PC (git-ignored, because this repo is public). Never commit them.
Plot about 7 × 43 m: rear garden about 29.5 m, house about 8 m deep, front about 5.5 m.
Rear garden faces south-east. Existing patio, hot tub, greenhouse and trees.
Tests use a made-up location with the same shape (`packages/flight-core/test/helpers.ts`).

## Working with the owner
- Explain in plain English, avoid jargon, give step-by-step instructions for anything they
  must do on the PC, phone or drone.
- Build in small stages that can be installed and tested on the phone.
