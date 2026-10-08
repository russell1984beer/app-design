# Turning a scan into a measured survey

After a garden scan, the photos are turned into a 3D model of the garden on your PC. Plotwise uses
the free OpenDroneMap software for this. The result is one small survey file. Open it in the app
on the phone or iPad, and the levels, contours, slope, measurements, design and materials all use
the real garden instead of the draft.

It costs nothing and nothing is uploaded anywhere. A garden scan takes about 10–30 minutes to
process.

## Setting up the PC (once)

1. **Install Docker Desktop** from docker.com (choose "Download for Windows – AMD64"). Run the
   installer and accept the defaults. Restart the PC if it asks.
2. **Open Docker Desktop.** Accept the agreement and skip the sign-in (an account is not needed).
   Wait until the bottom-left corner says **Engine running**.
3. **Give it enough memory.** In Docker Desktop: Settings (cog) > Resources. If there is a memory
   slider, set it to at least **8 GB**. Click **Apply & restart**.
4. **Install the survey tool.** In Git Bash:

   ```
   cd app-design/tools/survey
   npm install
   ```

5. **Download OpenDroneMap** (about 4 GB, once):

   ```
   docker pull opendronemap/odm:3.5.6
   ```

## After each scan

### 1. Send the scan details to the PC

On the phone, after the scan lands, tap **Send scan details to the PC** (on the Scan tab, or later
on the Survey tab). Email it to yourself or save it to Google Drive, then save the file
(`plotwise-scan-<date>.json`) on the PC, for example in `C:\Surveys\2026-10-09\`.

The file says where the take-off point was and how the plot lies, so the survey can be lined up
with your plan.

### 2. Copy the photos to the PC

Either:

- take the **microSD card** out of the drone (switched off), put it in a card reader, and copy the
  scan's photos from `DCIM\DJI_001` (or similar); or
- connect the drone to the PC with its USB-C cable and switch it on; it appears as a drive.

Copy only that scan's photos (check the times) into their own folder, for example
`C:\Surveys\2026-10-09\photos`.

### 3. Run the survey tool

Open Docker Desktop first and wait for **Engine running**. Then in Git Bash:

```
cd app-design/tools/survey
npm run survey -- --photos "C:\Surveys\2026-10-09\photos" --scan "C:\Surveys\2026-10-09\plotwise-scan-2026-10-09.json"
```

It shows each stage as it goes. When it finishes, it says where it saved the survey, for example
`C:\Surveys\2026-10-09\plotwise-survey-2026-10-09.json`, and how much of the plot the photos covered.

### 4. Open the survey in the app

Send the survey file to the phone or iPad (email, Google Drive, or a USB cable). In Plotwise, go
to the **Survey** tab and tap **Open survey file**, then pick it.

## If something goes wrong

- **"Docker is not installed" / "not running"**: open Docker Desktop and wait for
  **Engine running**, then run the command again.
- **"OpenDroneMap stopped with an error"**: the full log is `odm-log.txt` in the
  `plotwise-processing` folder next to the photos. Copy its last 40 lines into the chat.
- **Low coverage** (under 90%): some photos are missing or blurred. Fly the scan again.
- To try the lining-up again without reprocessing the photos:

  ```
  npm run survey -- --odm "C:\Surveys\2026-10-09\plotwise-processing\project" --scan "C:\Surveys\2026-10-09\plotwise-scan-2026-10-09.json"
  ```

## How accurate is it?

- **Levels** (rises and falls across the garden) come out to within a few centimetres.
- **Position on the map** relies on the drone's GPS, so the whole survey can be shifted by a
  metre or two. The levels and distances within the garden are unaffected.
- Contractor-grade accuracy needs the Matrice 4E's RTK, or ground control points.
