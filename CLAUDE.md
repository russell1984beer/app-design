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
    in the next 2 hours feeds the pre-flight wind check. Works against the live service on the owner's
    phone (9 October 2026: 8.6 m/s, gusts 16.8 m/s, take-off correctly blocked). Key: `EXPO_PUBLIC_METOFFICE_API_KEY` in `apps/flight/.env`.
  - `safety.ts`: safety settings and defaults, pre-flight checks, return-home battery maths.
  - `bridge.ts`: the `DroneBridge` interface the Android module must implement.
  - `flight-session.ts`: `FlightSession`, the phone-side flight controller.
  - `sim-drone.ts`: `SimDrone`, a simulated drone including its own failsafes.
  - Run `npm test` there and keep it green; `npm run typecheck` checks types.
  - End-to-end tests in `test/flight.test.ts` cover normal scans, signal loss, gusts,
    low battery (incl. headwind and a fast-draining battery), resume, the pilot's return
    button, the RC return button, pilot takeover, geofence, camera faults and obstacles.
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
    10 simulator tests pass; the Met Office forecast (`src/weather.ts`) gates real take-offs. State and scan progress are
    saved on the phone (AsyncStorage), so a stopped scan can resume.
  - Map zoom (`src/mapZoom.ts`, per tab): pinch with two fingers to zoom (up to 8x) and slide the map;
    +, − and Fit buttons top right. One finger works as before; a tap that turns into a pinch is taken back. Works on the phone, pinch smooth (9 October 2026).
  - Wide screens (phone sideways, iPad; `wide` in App.tsx): the title sits over the map in the left
    column and the panel runs full height on the right. Checked on the phone (9 October 2026). The tab bar is
    tucked away there; a round menu button (three lines) bottom-left of the map brings it up until a tab is picked (works on the phone; overlapping height labels are left out, tidier). Design feature labels likewise (`itemLabels`: selected, then new, then biggest; clear of the house label).
  - `src/EmergencyBar.tsx`: big red STOP button on every tab while the app flies the drone.
    `FlightSession.pilotHold()` stops and hovers; it waits for Resume / Return home / Land here.
    Battery, wind, geofence and signal-loss rules keep working while it hovers, and the pilot
    can still take the sticks.
  - Obstacle stop: before take-off the Kotlin module sets the drone's own obstacle avoidance to Brake
    (sideways and up) and passes the nearest sensor distance on as Telemetry `obstacleM` (read as mm,
    raw values in the 5 s log line; U9). FlightSession holds (like STOP, `holdReason` "obstacle") when
    something is within 3 m while scanning (1.5 m on roof circles), with 15 s grace after Resume.
    Test bench test 10 feeds a 2 m obstacle in (`setTestObstacle`).
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
  - First flight check (Scan tab, `src/panels/FirstFlight.tsx`; flight-core `planFirstFlight`, test
    `test/first-flight.test.ts`), as the owner chose: 10 m up, 60 s hover over the take-off point (wind
    reading vs Met Office for U2/U3, optional cable unplug for U8, "carry on" button), then the garden
    scan pattern over the bottom of the garden up to the take-off point (`firstFlightArea`, full width,
    far end first; about 63 photos at the default home), back over the take-off point, lands straight
    down (`Mission.endWith = "land"`, waypoint `holdS`). Recorded in `firstFlightDoneAt`. Flown in DJI's simulator (landed, 9 October 2026); not flown for real yet. Tallest tree in the bottom of the garden: about 5 m (owner), so 10 m leaves 5 m clear.
  - DJI FlySafe no-fly zones (real mode): `FlyZones.kt` asks the DJI SDK (`FlyZoneManager.
    getFlyZonesInSurroundingArea`) for the zones round the take-off point; `modules/dji-drone/src/flyZones.ts`
    turns them into flight-core `NoFlyZone`s (restricted and authorisation block, warning warns, height
    zones allow a flight whose highest point, including the return height, stays below the limit);
    `src/flysafe.ts` keeps them 6 h per place. Take-off waits for the lookup; if it fails it only warns
    (the drone still enforces DJI's zones itself). On the phone at the test property: first "none nearby", later "14 DJI
    zones nearby" (DJI's database had probably not downloaded the first time); still to be cross-checked
    against DJI Fly's GEO map.
  - Environment Agency LIDAR (free, England, Open Government Licence), real mode: `src/lidar.ts` fetches
    the 1 m DTM and first-return DSM from the Defra WCS services (coverage id, axis names and format read
    from GetCapabilities/DescribeCoverage at run time, as they could not be checked from the cloud
    workspace) for 70 m round the take-off point, and keeps them in `lidar.json`. garden-core `bng.ts`
    (WGS84 to National Grid, Helmert + OS Transverse Mercator, good to a few metres) and `raster.ts`
    (GeoTIFF strips/tiles, none/LZW/Deflate via pako, predictors 2/3; ESRI ASCII grid). `src/lidarMath.ts`:
    `obstacleHeights` (tallest thing within 5 m of the route, and over the flight area, above the
    take-off ground) feeds flight-core's clearance checks (`obstacles`: under 3 m clear blocks, under 5 m
    warns; return height must clear the area's tallest + 10 m); `lidarSurvey` makes it the Survey tab's
    levels until a drone survey is opened (`currentSurvey` falls back to it). Survey tab "Heights" layer
    and Plan-map labels show tree/roof heights; the map's street shows its ground height above sea level (LIDAR, ODN; `aboveSeaLevelM`; 73.3 m on the phone at the test property, owner says it looks about right). Without LIDAR the flight only warns. Fetched on the phone at the
    test property (9 October 2026): the house showed up about 9 m down the garden because the drone was
    on the patio, not the plan's take-off point. So `takeoffOffset` (lidarMath) finds the plan's house
    rectangle in the LIDAR heights and measures the shift along the garden: in real mode the Scan tab
    offers to move the take-off point to the drone, and the pre-flight check warns from 2.5 m and blocks
    from 5 m (every route and the geofence are placed from the drone's position, so a misplaced drone
    shifts them all). The Survey tab can re-line the stored LIDAR (`setLidarHome`); on the phone this put the 9.6 m block
    on the house (9 October 2026). The LIDAR is years old (an 8.5 m tree near the take-off point was cut
    down long ago), so the owner can mark tall spots as gone (Survey tab, Heights; `goneSpots` on the plan):
    within 4 m of them the map and the clearance check use the ground, and the pre-flight list warns that
    they are being ignored.
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
    the test area is now 20 x 12 m (28 photos, about 2 minutes), placed where the simulated drone is.
    All 9 simulator tests passed in DJI's simulator (9 October 2026). Test 6 (gust): DJI's simulator wind does not reach the drone's wind
    reading (0 m/s), so the test feeds a 9 m/s wind into the app (`setTestWind`, test bench only); U2/U3
    (wind unit and direction) must be checked against DJI Fly on the first real flights. Test 7 (cable unplugged): DJI's simulator ends the simulated flight
    when the phone is unplugged (afterwards: links up, motors off, position frozen), so the app now ends
    the flight as landed when the link is back and the drone says it is on the ground (`linkUp`);
    picking a real flight back up (U8) is checked on the first real flight. Listeners are also renewed
    every 5 s while both links are up but the position is stale. The drone refuses a
    new home point until it has recorded its own, so the app retries for 20 s. Until a survey file is opened, the Survey uses a
    draft of the garden from the title plan with estimated levels. Roof damage detection is not
    built: the roof report is a labelled example.
  - Open questions U1–U9 in the doc must be settled in DJI's simulator before any real flight.
- The clickable prototype is in `prototype/plotwise-prototype.html` (address removed; keep it that way).
- The app must be built on the owner's Windows PC.
- Next: the first flight check
  (built) in the garden, which also checks U2/U3 (wind) and U8 (cable out while hovering); cloud upload and sync, the first iPad build (owner needs Apple Developer + Expo accounts).

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
