# Putting Plotwise on the iPad

The iPad gets the same app without the flying parts: Plan (view only), Survey, Design, Roof
(report) and Materials. Flying stays on the Android phone, because DJI's software only works on
Android.

There is no Mac, so the iPad version is built in the cloud by Expo (the company behind the tools
this app uses) and sent to the iPad through Apple's TestFlight app.

## What you need (once)

1. **An Apple Developer account.** Sign up at developer.apple.com/programs with your Apple ID.
   It costs £79 a year. Apple can take a day or two to approve it.
2. **A free Expo account.** Sign up at expo.dev.
3. **The TestFlight app** on the iPad, from the App Store (free).

## Building it (about 20–30 minutes, mostly waiting)

In Git Bash on the PC, in `app-design\apps\flight`:

```
git pull
npm install
npm run ipad
```

The first time, it asks a few questions. The answers:

- **Log in to Expo:** your Expo email and password.
- **Create a project for this app?** Yes.
- **Log in to your Apple account?** Yes, then your Apple ID and the code Apple sends to your
  iPhone or iPad.
- **Generate a new Apple distribution certificate / provisioning profile?** Yes to each. Expo
  stores them for you.
- **Bundle identifier:** keep `com.plotwise.app`.

The build then runs on Expo's computers. When it finishes, it is sent to Apple automatically.
Apple checks it (10–60 minutes), then you get an email.

## Installing it on the iPad

1. Open **TestFlight** on the iPad and sign in with the same Apple ID.
2. Plotwise appears in the list. Tap **Install**.
3. For later versions, run `npm run ipad` again; TestFlight offers the update.

## What is not there yet

- **Your designs do not move between the phone and the iPad yet.** Each keeps its own. Syncing
  through the cloud comes with photo upload and survey processing.
- The iPad version has not been built yet, so the first build may need a fix or two. Copy the
  last 40 lines of any error into the chat.
