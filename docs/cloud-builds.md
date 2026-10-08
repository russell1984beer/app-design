# Building the phone app in the cloud (no PC needed)

Instead of building the app on the PC and copying it over the USB cable, the app can be built on
Expo's computers. Claude starts the build from the cloud workspace; you get a link, open it on the
drone phone, and install the new version with a couple of taps.

The DJI App Key is stored privately in your Expo account (never in the project files, which are
public). The finished app contains the key, so **never share the download link**.

## Setting it up (once, about 15 minutes)

### 1. Make a free Expo account

Go to **expo.dev** and sign up. (The same account is needed later for the iPad.)

### 2. Make an access code for Claude

1. On expo.dev, click your picture (top right) > **Account settings** > **Access tokens**.
2. Click **Create token**, call it `Claude cloud builds`, and copy the code it shows.
   Do not paste it into the chat.

### 3. Give the code to the cloud workspace, and let it reach Expo

In the Claude app, open this project's cloud environment settings (the environment menu in the
session's title bar, then **Edit**):

1. Under **Environment variables**, add a line:
   ```
   EXPO_TOKEN=the-code-you-copied
   ```
2. Under **Network access**, choose **Limited** (or **Custom**) and add these to **Allowed domains**,
   keeping "Allow package managers" ticked:
   ```
   expo.dev
   api.expo.dev
   *.expo.dev
   storage.googleapis.com
   ```
3. Save, then start a **new** session (settings only reach new sessions) and tell Claude:
   "The Expo token and network are set up; carry on with docs/cloud-builds.md."

### 4. Claude creates the Expo project

Claude runs `eas init`, which creates a project called **plotwise-flight** in your Expo account and
adds its id to `app.json`.

### 5. Put the DJI App Key in Expo (you do this; Claude never sees the key)

1. On expo.dev, open **Projects** > **plotwise-flight** > **Environment variables**.
2. Click **Add variable**:
   - Name: `DJI_API_KEY`
   - Value: your DJI App Key (the same as in `apps/flight/.env` on the PC)
   - Environments: tick **Preview**
   - Visibility: **Secret**
3. Save. (Later, the Met Office key goes in the same way, named `EXPO_PUBLIC_METOFFICE_API_KEY`,
   visibility **Sensitive**.)

## Each new version

1. Claude runs `npm run phone:cloud` and sends you the build page link. A build takes about
   15–30 minutes (the free plan can queue for a while first).
2. When it finishes, open the link **on the drone phone**, tap **Install**, then open the downloaded
   file. The first time, Android asks to allow installs from Chrome: tap **Settings**, switch on
   **Allow from this source**, go back, and tap **Install**.

### The first cloud build only

The cloud-built app is signed with a different key from the one built on the PC, so Android will
not install it over the top. Uninstall the old one first: hold the Plotwise icon > **App info** >
**Uninstall**. (The simulator test results are stored in the app, so they are cleared; none have
passed yet.)

You can still build on the PC with `npm run phone` at any time, but switching between PC and cloud
builds needs an uninstall each time.
