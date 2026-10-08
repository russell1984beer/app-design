# Drone garden survey and design app (working name: Plotwise)

Project brief for Claude Code. Read this first in every session.

## What we are building
A mobile app that flies a DJI drone automatically over a property, turns the photos into a
measured survey (dimensions, levels, contours), and gives the owner a garden design tool,
roof inspection and material quantities. The owner (non-developer) supervises flights and
tests builds on real devices.

The clickable prototype (`prototype/plotwise-prototype.html`, open it in a browser) shows the
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
- One cross-platform codebase: **React Native with Expo** (chosen, because flight-core is
  TypeScript and runs in the app unchanged) with a native Android module wrapping DJI MSDK v5.
- iOS builds happen in the cloud (e.g. Expo EAS Build) and go to the iPad via TestFlight.
- Scans flown on Android sync to the cloud and appear on iOS.

## Secrets
- The DJI App Key is tied to the package name, `com.plotwise.app` (Android package and iOS bundle id). Keep it in an untracked local config file
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
- `packages/garden-core/` (TypeScript, no dependencies; for iOS and Android): the prototype's plot
  model and draft levels, contours, slope, design features and styles, sun and shade, plants,
  material quantities and the example roof report. `npm test` there.
- Survey processing (stage 1, free, on the owner's PC): after a real scan the app records the scan
  details (take-off GPS, plot, home point) and shares them as `plotwise-scan-<date>.json`.
  `tools/survey` (`npm run survey -- --photos <dir> --scan <file>`) runs OpenDroneMap 3.5.6 in Docker
  (DSM + DTM + orthophoto at 2 cm) and converts the GeoTIFFs (UTM) into `plotwise-survey-<date>.json`:
  ground/surface height grids (25 cm) and the plot photo, lined up through the scan details. The app
  opens it (Survey tab, iPad too); levels, contours, slope, design and materials then use it. Steps for
  the owner: `docs/survey-processing.md`. Checked end to end in the cloud workspace with computer-drawn
  photos of a known garden (with raised houses) flown on the real plan: ground levels within 0.5 cm
  median, 2.7 cm worst; roof height 6.02 m against 6.00 m.
  Cloud upload/sync of photos and surveys is not built yet.
- `packages/flight-core/` (TypeScript, no runtime dependencies, needs Node 22.18+):
  - `planner.ts`: grid mission over a drawn boundary, angled orbit for walls/roof. `planSurvey` is
    the garden scan, fixed to the owner's chosen plan (the prototype's): passes straight across the
    plot, front to back, first and last along the end boundaries, about 0.75 x height x (1 - overlap)
    apart (3.6 m at the default 20 m and 75%), flown back and forth. It never crosses the property
    boundary. Take-off and landing are at the home point (default: middle of the rear garden,
    movable on the Plan map); the drone's own Return to Home brings it back there at the end.
    Optional (Plan tab switch, off by default): a lap round the plot's edge after the passes, camera
    tilted -60° looking in, also inside the boundary.
  - `roof.ts`: roof scan as in the prototype: two full circles round the house, 6 m then 3 m above
    the ridge, 24 photos each, at least 2 m out from the roof and 2 m above the chimney, with its own
    flight area. The circles pass over next door's half (pre-flight warns about overflight).
  - `weather.ts`: Met Office Weather DataHub site-specific hourly forecast (apikey header); worst gust
    in the next 2 hours feeds the pre-flight wind check. Not yet tried against the live service
    (blocked from the cloud workspace). Key: `EXPO_PUBLIC_METOFFICE_API_KEY` in `apps/flight/.env`.
  - `safety.ts`: safety settings and defaults, pre-flight checks, return-home battery maths.
  - `bridge.ts`: the `DroneBridge` interface the Android module must implement.
  - `flight-session.ts`: `FlightSession`, the phone-side flight controller.
  - `sim-drone.ts`: `SimDrone`, a simulated drone including its own failsafes.
  - Run `npm test` there and keep it green; `npm run typecheck` checks types.
  - End-to-end tests in `test/flight.test.ts` cover normal scans, signal loss, gusts,
    low battery (incl. headwind and a fast-draining battery), resume, the pilot's return
    button, the RC return button, pilot takeover, geofence and camera faults.
    `test/roof.test.ts` covers the roof scan. Damage detection is not built yet.
  - All planning and safety logic belongs here, not in the Android module.
- `apps/flight/` (Expo SDK 57; flies on Android, other tabs also on iPad): the app. See `docs/android-flight-module.md`.
  - `modules/dji-drone/`: local Expo module. Kotlin `DroneController` drives the drone through
    DJI MSDK 5.18.0 (virtual sticks for movement, the drone's own failsafes stay on);
    `NativeDroneBridge.ts` implements flight-core's `DroneBridge` on top of it.
  - `plugins/withDji.js`: config plugin adding the App Key (from `.env`), USB filter and SDK start-up.
  - `App.tsx` + `src/`: the app, laid out like the prototype: map on top, panel below, tabs Plan,
    Scan, Survey, Design, Roof, Materials. `src/flight.ts` places the plot on GPS from the home
    point (the drone's position in real mode, a made-up field in simulator mode) and the garden's
    compass direction, and runs flights through one shared drone connection (`src/drone.ts`).
    Scan and Roof have a DJI simulator / Real flight switch; real flights stay blocked until all
    9 simulator tests pass; the Met Office forecast (`src/weather.ts`) gates real take-offs. State and scan progress are
    saved on the phone (AsyncStorage), so a stopped scan can resume.
  - `src/EmergencyBar.tsx`: big red STOP button on every tab while the app flies the drone.
    `FlightSession.pilotHold()` stops and hovers; it waits for Resume / Return home / Land here.
    Battery, wind, geofence and signal-loss rules keep working while it hovers, and the pilot
    can still take the sticks.
  - Materials tab: editable unit prices (saved on the phone), Export PDF quote (expo-print) and
    Export DXF plan (R12, metres), both through the share sheet. Generators in garden-core `export.ts`.
  - iPad: `app.json` has iOS (`com.plotwise.app`, tablet); `eas.json` profile `ipad`;
    `npm run ipad` builds in Expo's cloud and sends it to TestFlight (see `docs/ipad.md`). Off
    Android the DJI module is replaced by a stand-in (`canFly` false): no Scan tab, no flight buttons.
    Not built for iOS yet.
  - Cloud builds for the phone (being set up, see `docs/cloud-builds.md`): `eas.json` profile `phone`
    (internal APK, EAS environment `preview`, `DJI_API_KEY` stored as an Expo secret by the owner);
    `npm run phone:cloud` starts it from the cloud workspace with `EXPO_TOKEN`. Needs expo.dev hosts
    allowed in the environment's network settings. The APK contains the DJI key: never share its link.
  - `src/TestBench.tsx` (Scan tab > Simulator tests): runs the same scenarios as
    `test/flight.test.ts` and records which have passed.
  - `npm test` there runs the adapter and plugin tests; `control-tests/` runs the Kotlin
    control tests with Gradle.
  - Builds in the cloud workspace (dl.google.com allowed; Android SDK at /opt/android-sdk, Java 17
    needed). Maven Central rate-limits this machine, so a local Gradle init script points it at
    Google's Maven Central mirror. Release app is ~200 MB and contains the DJI key: never publish it.
  - Runs on the owner's Galaxy S22 (built on the PC with Temurin JDK 17; Android Studio's newer
    JBR breaks the CMake step). DJI SDK native code needs its own libc++_shared.so (NDK r28),
    packaged by the plugin from `modules/dji-drone/android/libcxx/`; nothing may call DJI managers
    before `DjiSdk.initialized`. Key listeners set up before registration never report, so they are
    renewed on registration and on each drone connection (plus a once-a-second direct read). Connected
    to the drone and DJI's simulator. Test 1: takes off and scans, but twice the drone started its own Return to Home
    (53/84 and 70/84 photos) with battery 69%, low-battery RTH idle and both links up; the app now
    also shows the drone's own warnings (DeviceHealthManager). Third run: "Aircraft temperature high"
    26 s before the drone's own return, so likely overheating on the table (motors on, no airflow);
    the test area is now 20 x 12 m (28 photos, about 2 minutes) and the owner cools the drone with a fan. The drone refuses a
    new home point until it has recorded its own, so the app retries for 20 s. Until a survey file is opened, the Survey uses a
    draft of the garden from the title plan with estimated levels. Roof damage detection is not
    built: the roof report is a labelled example.
  - Open questions U1–U8 in the doc must be settled in DJI's simulator before any real flight.
- The clickable prototype is in `prototype/plotwise-prototype.html` (address removed; keep it that way).
- The app must be built on the owner's Windows PC.
- Next: owner builds the app and runs the 9 simulator tests; then the owner adds a Met Office key; DJI FlySafe
  no-fly zones, cloud upload and sync, the first iPad build (owner needs Apple Developer + Expo accounts).

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
