# Android flight module

How the flight app talks to the DJI Mini 4 Pro, how to build it on the Windows PC, and the
simulator tests it must pass before any real flight.

## How it fits together

```
Phone app (React Native + Expo)                                  Drone
┌───────────────────────────────────────────┐
│ flight-core (TypeScript)                  │
│   FlightSession: decides what to do       │
│   safety rules, mission plans             │
│        │ DroneBridge                      │
│ NativeDroneBridge.ts (JavaScript adapter) │
├────────┼──────────────────────────────────┤
│ DjiDroneModule.kt  (Expo module, thin)    │
│ DroneController.kt (talks to DJI SDK)     │──USB──► RC-N2 ──radio──► Mini 4 Pro
│ GoToController.kt  ("fly to this point")  │
│ DjiSdk.kt          (starts the DJI SDK)   │
└───────────────────────────────────────────┘
```

- **All decisions stay in flight-core**, the same code the tests and the preview run.
  The Android side only carries out commands and reports back.
- **Moving the drone:** after take-off the app takes control with DJI "virtual sticks" and
  sends a speed and direction ten times a second (`GoToController.kt`). If the drone moves away
  from its target for 4 seconds, the module stops it and hands back to the pilot.
- **Safety rules kept on the Android side**, because they must hold even if the JavaScript side
  freezes:
  - No take-off until the home point, return height and signal-loss action are stored on the
    drone itself.
  - Once the pilot takes over, the app never takes control back by itself.
  - Commands are only sent while the app has control.
- **The drone's own failsafes stay on:** signal-loss return, DJI's own low-battery return and
  the RC-N2's Return to Home button all work with no app at all.

### How the pilot takes over

While the app is flying the drone, **moving the sticks does nothing**. That is how DJI virtual
sticks work. To take over:

1. Press the **Pause button** on the RC-N2 once. The drone stops and hovers, and you have the
   sticks.
2. Or press and hold the **Return to Home button** until it beeps. The drone flies home.
3. Or tap the big red **STOP** button at the bottom of the app screen. The drone stops and
   hovers where it is, then waits for you: **Resume scan**, **Return home**, or **Land here**
   (tap twice, only if the ground below is clear). The sticks still do nothing until you press
   Pause. Low battery, strong wind and the geofence still bring it home by itself while it waits.

The app sees the controller buttons straight away and stops sending commands. Tests 4, 5 and 9 below check
this. Practise all three until they are automatic before any real flight.

## Files

| Path | What it is |
| --- | --- |
| `apps/flight/` | The Expo app. |
| `apps/flight/App.tsx`, `apps/flight/src/` | The app: Plan, Scan, Survey, Design, Roof and Materials tabs, laid out like the prototype. |
| `apps/flight/src/TestBench.tsx` | The simulator test bench (Scan tab > *Simulator tests*). |
| `apps/flight/modules/dji-drone/` | The drone module (Kotlin + TypeScript). |
| `apps/flight/plugins/withDji.js` | Adds the DJI App Key and start-up code to the Android project. |
| `apps/flight/modules/dji-drone/control-tests/` | Runs the Kotlin flight-control tests without Android. |

DJI Mobile SDK version: **5.18.0** (`modules/dji-drone/android/build.gradle`).

## What has been checked, and what has not

Checked in the cloud workspace:

- **flight-core tests:** 47 passing.
- **garden-core tests:** 13 passing.
- **JavaScript adapter tests:** 7 passing. These fly the full FlightSession through the adapter
  against a fake drone.
- **Setup plugin tests:** 4 passing.
- **Kotlin flight-control tests:** 9 passing (`GoToController`, telemetry rules).
- **Compiled against the real DJI SDK 5.18.0:** `DroneController.kt` and `DjiSdk.kt`, so every
  DJI function, key and type they use exists with the right types.
- **App type-check:** passes.
- **Expo project generation:** with the plugin, it produces the right Android project (App Key,
  USB controller filter, DJI start-up calls, packaging settings).

- **Full Android build:** debug and standalone release builds succeed, including
  `DjiDroneModule.kt`. The build needs Java 17 (Gradle finds or downloads it).

Not checked yet:

- **Anything with the real drone or DJI's simulator.**

**Unknowns the simulator tests must settle.** The DJI SDK's published files do not document these:

| # | Question | How the code handles it now | Checked by |
| --- | --- | --- | --- |
| U1 | Virtual sticks in the ground frame: is *pitch* east and *roll* north, or the other way round? | Assumes pitch = east. **Settled: correct** (test 1 flew the whole scan). | Test 1 |
| U2 | Wind speed unit from the drone | Assumes tenths of a m/s. **Not settled in the simulator**: DJI's simulator wind does not reach the Mini 4 Pro's wind reading (it stays at 0), so test 6 feeds the wind into the app instead. Check on the first real flights by comparing with the wind DJI Fly shows. | First real flights |
| U3 | Does the wind direction mean "from" or "to"? | Assumes "from". Not settled in the simulator (see U2). | First real flights |
| U4 | Simulator wind axes (which is north) | Sets X = north. Not needed: the simulator's wind has no effect on the drone's reading. | — |
| U5 | Will the drone accept a home point set from the app? | Sets it before take-off; refuses to take off if this fails. **Settled: yes**, once the drone has recorded its own home point (a few seconds after a GPS fix); the app retries for 20 s. | Test 1 |
| U6 | Does the camera report each new photo in the simulator? | Waits up to 5 s for the photo report, otherwise counts the photo as failed. **Settled: yes** (28/28). | Test 1 |
| U7 | Does Return to Home work straight after the app hands back the sticks? | Hands back the sticks, then starts Return to Home. **Settled: works** (test 2 passed). | Test 2 |
| U8 | What happens to virtual sticks when the phone is unplugged? | Expects the drone to stop and hover. In DJI's simulator the simulated flight ends when the cable comes out (afterwards the drone reports motors off and its position never moves), so this can only be settled on the **first real flight**: hovering low in the garden, unplug the phone for a few seconds, check the drone holds position and that the app brings it home once the cable is back. | First real flight |
| U9 | The drone's obstacle distances: are they millimetres, and which values mean "nothing seen"? Does the drone brake by itself while the app flies it with virtual sticks? | Reads them as millimetres; 0 and anything over 50 m count as nothing. Switches the drone's obstacle sensing on and sets it to **Brake** before each flight (the Mini 4 Pro refuses per-direction settings: "not supported", seen on the phone). In DJI's simulator the sensors' distances are ignored (on the table they see the room, about 0.3 m, which stopped test 1). The phone's log shows the raw numbers every 5 seconds (`obstacle=h=<nearest>/<count>@<angle> up=<value>`). On the **first real flight**, while it hovers at 10 m, walk up to about 5 m from the drone's side (never under it): the log's nearest number should drop to about 5000. | First real flight |

## One-time setup on the Windows PC

Do these in order. Each step says how to check it worked.

1. **Install Node.js 22 LTS** (22.18 or newer) from nodejs.org. Use the Windows installer and
   accept the defaults.
   Check: open *Command Prompt* and type `node --version`. It should say v22.18 or higher.
2. **Install Git** from git-scm.com, accepting the defaults.
   Check: `git --version`.
3. **Install Android Studio** from developer.android.com/studio. When it first opens, choose
   *Standard* setup. This installs the Android SDK and Java.
4. **Tell Windows where the Android SDK is:**
   1. Start menu → type *environment variables* → *Edit the system environment variables* →
      *Environment Variables…*
   2. Under *User variables*, click *New*. Name: `ANDROID_HOME`. Value:
      `C:\Users\<your name>\AppData\Local\Android\Sdk`
   3. Select *Path* → *Edit* → *New* → `%ANDROID_HOME%\platform-tools` → OK.
   4. Close and reopen Command Prompt.

   Check: `adb --version`.
5. **Get the code:**
   ```
   cd %USERPROFILE%
   git clone https://github.com/russell1984beer/app-design.git
   cd app-design
   git checkout claude/claude-md-review-18d42l
   ```
6. **Get a DJI App Key:**
   1. Sign in at developer.dji.com.
   2. Go to *User Center → Apps → Create App*. App type: **Mobile SDK**. Package name:
      **com.plotwise.app** (it must be exactly this).
   3. Activate the app from the email DJI sends.
   4. Copy the App Key.
7. **Put the key in a file that never gets uploaded:**
   ```
   cd apps\flight
   copy .env.example .env
   notepad .env
   ```
   Paste the key after `DJI_API_KEY=`, save and close. `.env` is git-ignored. Never paste the
   key into chat, an issue or a commit.
8. **Set up the Galaxy S22 for development:**
   1. *Settings → About phone → Software information*: tap *Build number* 7 times.
   2. *Settings → Developer options*: turn on *USB debugging*.
   3. Plug the phone into the PC and tap *Allow* on the phone.

   Check: `adb devices` lists the phone.

## Build and install the app

The full Android build has been run successfully in the cloud workspace (debug and standalone
release builds, DJI SDK 5.18.0 included). The app file is about 200 MB, too big to send through
the chat, so the PC builds the same thing and installs it on the phone.

From `app-design\apps\flight` in Git Bash, with the phone plugged into the **PC**:

```
git pull
npm install
npm run prebuild
npm run phone
```

- **`git pull`** gets the latest fixes.
- **`npm run phone`** builds the standalone app and installs it on the phone. The first build
  takes 10–30 minutes. It ends with the app opening on the phone at the Plan tab. The simulator tests are under
  the **Scan** tab: tap *Simulator tests*.
- The standalone app runs on its own, so the PC is not needed after this.

If the build fails, copy the **last 40 lines** of the output into the chat (check there is no
App Key in them).

## Met Office weather key (needed for real flights only)

Before a real flight, the app checks the Met Office wind forecast for the take-off point and
refuses to take off if gusts in the next 2 hours are over your limit. The simulator does not
need it. To set it up, once:

1. Go to **datahub.metoffice.gov.uk** and create a free account.
2. Subscribe to the **Site Specific** forecast, on the free plan (360 requests a day; the app
   uses about one per flight).
3. Copy your **API key**.
4. On the PC, open the `.env` file in `app-design\apps\flight` (the same file as the DJI key) in
   Notepad and add a new line: `EXPO_PUBLIC_METOFFICE_API_KEY=` followed by the key.
5. Rebuild the app: `npm run prebuild` then `npm run phone`.

The key stays on your PC and phone; `.env` is never uploaded to GitHub. Checked against the live Met Office service on 9 October 2026.

## Before every simulator session

1. **Update** the drone and the RC-N2 to the latest firmware using the DJI Fly app.
2. **Take the propellers OFF.** Put the drone on a table, away from anything it could hit if
   the motors start.
3. **Close DJI Fly completely.** Only one app can use the controller at a time.
4. **Connect:** switch on the controller, then the drone. Plug the phone into the RC-N2 (not
   the PC).
5. **Open Plotwise Flight.** If Android asks which app to open for the USB device, choose
   Plotwise Flight. Go to the **Scan** tab and tap **Simulator tests**.
6. **Check the top card** shows "DJI SDK registered" then "Drone connected". The first time,
   registration needs internet.
7. **Tap *Start simulator*.** The motors do not spin in the simulator, but take the propellers
   off anyway.

## Simulator tests

Run them in order from the app. Each one says what to do and what should happen, and shows
**PASS** or **CHECK** at the end. The app remembers each pass; the *Real flight* switch on the
Scan and Roof tabs stays blocked until all 10 have passed. Fill in this table and send it back, along with anything that
looked wrong.

| Test | What it checks | Result | Notes |
| --- | --- | --- | --- |
| 1. Normal scan | Whole scan, photos, landing at home. Settles U1, U5, U6. | PASS | |
| 2. Return button in the app | App's Return button. Settles U7. | PASS | |
| 3. Resume | Carries on after test 2, only the missing photos. | PASS | |
| 4. Return button on the controller | RC-N2 RTH button overrides the app. | PASS | |
| 5. Pilot takes over | Pause button gives the sticks back to you. | PASS | |
| 6. Gust | Wind limit (app side: a 9 m/s wind fed into the app). | PASS | The drone reports 0 m/s with the simulator wind at 9 m/s, so the test feeds the wind into the app. |
| 7. Phone loses the controller | Phone cable unplugged mid-scan: the app sees the signal go and sends nothing. | PASS | The simulated flight ends with the cable; picking a flight back up is checked on the first real flight (U8). |
| 8. Controller switched off | The drone's own signal-loss failsafe. |  PASS | |
| 9. Emergency STOP button | The red STOP button: hovers in place until you choose Resume, Return home or Land here. |  PASS | |
| 10. Obstacle close by | The app's obstacle stop (a 2 m obstacle fed into the app for 3 seconds): stops, says why, hovers until Resume. | PASS | DJI's simulator has nothing for the drone's sensors to see. |

**Not tested in the simulator:**

- **Low battery.** DJI's simulator battery drains too slowly to reach it. The automatic tests
  cover it (normal, headwind and worn battery).
- **The geofence.** The test plan stays inside the area. It is covered by the automatic tests.

### Obstacle stop

Two layers, both on during app flights:

- **The drone's own brake.** Before every take-off the app sets the drone's obstacle avoidance to
  Brake, sideways and upwards. A failure only warns.
- **The app's stop.** If the drone's sensors report anything within 3 m (1.5 m on the roof circles,
  which fly 2 m from the roof) during the scan, the app stops and hovers exactly like the STOP
  button, and the yellow bar says it stopped for an obstacle. Resume ignores obstacles for 15 seconds
  so you can carry on past it; Return home or Land here as usual. It does not act during take-off,
  the return or landing (the drone's own brake and the pilot cover those).

Thin branches and wires are hard for any drone's sensors to see, so it does not replace the
clearance check or watching the drone.

## After all 10 pass: the first flight check

All 9 passed on 9 October 2026; test 10 (the obstacle stop, added afterwards) passed the same evening. The first real flight is the **first flight check** on the Scan
tab (Set up the first flight check). It takes off, climbs to 10 m above the take-off point, hovers
for 60 seconds, then scans the bottom of the garden up to the take-off point (the full width, in the
garden scan's pattern, starting at the far end), comes back over the take-off point and lands
straight down (it does not climb to the return height unless a safety rule or the pilot sends it
home). Check that every tree and aerial in that part of the garden is well under 10 m first.

On Real flight the Scan tab also fetches the Environment Agency's free LIDAR for the area (the
"Heights" line). The pre-flight list then says how much clearance the route has over the tallest
tree or roof near it (it blocks under 3 m and warns under 5 m), and checks the return height
clears the tallest thing in the area by 10 m. The LIDAR may be a few years old and its position is
good to a few metres, so still look at the route yourself.

**Put the drone on the yellow take-off point on the Plan map.** Every flight, and the fence round
the plot, is placed from where the drone actually stands. The app checks this with the LIDAR: if
your house shows up shifted, it says how far the drone is from the take-off point, offers to move
the take-off point to the drone, and blocks take-off when it is 5 m or more out.

Before it:

1. The Met Office key is in `apps/flight/.env` and the app has been rebuilt (real take-offs are
   blocked without a forecast).
2. Switch the drone off and on after any simulator session (the simulator leaves it refusing to
   take off).
3. Daylight, low wind, propellers on, the drone on the take-off point in the garden, people and pets
   indoors. Switch the Scan tab to **Real flight** and tick Before you fly on the Plan tab.
4. Hold the controller the whole time. Pause stops the drone and gives you the sticks; Return to
   Home brings it back.

While it hovers, the screen shows:

- **Wind:** the drone's own reading next to the Met Office forecast. Take a screenshot. This
  settles U2 and U3 (a reading ten times too big or small, or from the opposite side, means the
  units or direction are read wrongly).
- **Unplugging the phone (optional):** unplug for 5 seconds, then plug back in. The drone should
  hold its position; when the cable is back the app brings it home (U8). The check ends there.
- **Carry on to the scan now** skips the rest of the hover.

Try it in DJI's simulator first if you like (propellers off): the same button works there.

## Not built yet

- **Uploading photos to the cloud and processing them into a survey.** The Survey tab uses a
  draft of the garden from the title plan with estimated levels.
- **Roof damage detection.** The Roof tab shows a labelled example report.
- **Placing the plot from a satellite map.** For a real flight the plot is lined up from the
  take-off point (set on the Plan map, with the drone sitting on it) and the garden's compass
  direction on the Plan tab. A wrong direction shifts the whole plan, so check it carefully.
