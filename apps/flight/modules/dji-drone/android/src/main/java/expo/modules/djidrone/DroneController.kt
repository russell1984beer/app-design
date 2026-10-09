package expo.modules.djidrone

import android.util.Log
import dji.sdk.keyvalue.key.BatteryKey
import dji.sdk.keyvalue.key.CameraKey
import dji.sdk.keyvalue.key.DJIKey
import dji.sdk.keyvalue.key.DJIKeyInfo
import dji.sdk.keyvalue.key.FlightControllerKey
import dji.sdk.keyvalue.key.GimbalKey
import dji.sdk.keyvalue.key.KeyTools
import dji.sdk.keyvalue.key.ProductKey
import dji.sdk.keyvalue.key.RemoteControllerKey
import dji.sdk.keyvalue.value.camera.CameraMode
import dji.sdk.keyvalue.value.camera.GeneratedMediaFileInfo
import dji.sdk.keyvalue.value.common.EmptyMsg
import dji.sdk.keyvalue.value.common.LocationCoordinate2D
import dji.sdk.keyvalue.value.common.LocationCoordinate3D
import dji.sdk.keyvalue.value.flightcontroller.FailsafeAction
import dji.sdk.keyvalue.value.flightcontroller.FlightControlAuthority
import dji.sdk.keyvalue.value.flightcontroller.FlightControlAuthorityChangeReason
import dji.sdk.keyvalue.value.flightcontroller.FlightCoordinateSystem
import dji.sdk.keyvalue.value.flightcontroller.FlightMode
import dji.sdk.keyvalue.value.flightcontroller.RollPitchControlMode
import dji.sdk.keyvalue.value.flightcontroller.VerticalControlMode
import dji.sdk.keyvalue.value.flightcontroller.VirtualStickFlightControlParam
import dji.sdk.keyvalue.value.flightcontroller.WindDirection
import dji.sdk.keyvalue.value.flightcontroller.WindWarning
import dji.sdk.keyvalue.value.gimbal.GimbalAngleRotation
import dji.sdk.keyvalue.value.gimbal.GimbalAngleRotationMode
import dji.v5.common.callback.CommonCallbacks
import dji.v5.common.error.IDJIError
import dji.v5.manager.KeyManager
import dji.v5.manager.diagnostic.DJIDeviceHealthInfoChangeListener
import dji.v5.manager.diagnostic.DeviceHealthManager
import dji.v5.manager.aircraft.simulator.InitializationSettings
import dji.v5.manager.aircraft.simulator.SimulatorManager
import dji.v5.manager.aircraft.simulator.SimulatorWindInfo
import dji.v5.manager.aircraft.virtualstick.VirtualStickManager
import dji.v5.manager.aircraft.virtualstick.VirtualStickState
import dji.v5.manager.aircraft.virtualstick.VirtualStickStateListener
import expo.modules.djidrone.control.GoToController
import expo.modules.djidrone.control.Position
import expo.modules.djidrone.control.StickCommand
import expo.modules.djidrone.control.Target
import expo.modules.djidrone.control.TelemetryRules

/** Runs work on one thread, so the controller's state is only ever touched from there. */
interface Scheduler {
  fun post(task: () -> Unit)
  fun postDelayed(delayMs: Long, task: () -> Unit)
  fun cancelAll()
  fun nowMs(): Long
}

/**
 * The DJI side of the flight-core DroneBridge. Flight decisions (where to go, when to come home)
 * are made by FlightSession in JavaScript; this class only carries them out and reports back.
 *
 * Safety rules kept here, because they must hold even if the JavaScript side stops:
 * - no take-off until the home point, return height and signal-loss action are stored on the drone;
 * - once the pilot takes control (pause button, mode switch), the app never takes it back by itself;
 * - if the drone is not moving towards its target, stop and hover;
 * - virtual stick commands are only sent while the app has control.
 */
class DroneController(
  private val scheduler: Scheduler,
  private val emit: (event: String, body: Map<String, Any?>) -> Unit,
) {
  private val keys get() = KeyManager.getInstance()
  private val sticks get() = VirtualStickManager.getInstance()

  // Latest values from the drone.
  private var location: LocationCoordinate3D? = null
  private var locationAtMs = 0L
  private var compassHeading = 0.0
  private var battery: Int? = null
  private var djiFlightMode: FlightMode? = null
  private var isFlying = false
  private var motorsOn = false
  private var rcConnected = false
  private var aircraftConnected = false
  private var productType: String? = null
  private var windSpeed: Int? = null
  private var windDirection: WindDirection? = null
  private var windWarning: WindWarning? = null
  private var virtualStickEnabled = false
  private var authority: FlightControlAuthority? = null

  // What the app has asked for.
  private enum class Failsafe { NONE, PENDING, CONFIGURED, FAILED }
  private var failsafe = Failsafe.NONE
  private var takeoffRequestedAtMs: Long? = null
  private var appTakeoffInProgress = false
  private var takeoffStartedAtMs = 0L
  /** Take-off finished, waiting for virtual sticks to come on. */
  private var handingOverAtMs: Long? = null
  private var pilotTookOver = false
  private var target: Target? = null
  private val goTo = GoToController()
  private var pendingPhoto: PendingPhoto? = null
  private var running = false

  private class PendingPhoto(val waypointIndex: Int, var deadlineMs: Long, var shutterFired: Boolean = false)

  // ---- Lifecycle -------------------------------------------------------------------------------

  fun start() = scheduler.post {
    if (running) return@post
    running = true
    tick()
    // The DJI SDK's native code is only loaded once it has started; listening earlier crashes the app.
    DjiSdk.whenInitialized { scheduler.post { if (running) startListening() } }
    DjiSdk.addConnectHook(onConnect)
  }

  // Listeners set up before the app was registered or the drone connected may never report, so
  // they are set up again each time either happens.
  // Seen on the phone after the cable was unplugged and plugged back in: listeners renewed at the
  // moment of reconnection stayed silent, so they are renewed again a few seconds later.
  private val onConnect: () -> Unit = {
    scheduler.post { renewListeners() }
    scheduler.postDelayed(RELISTEN_AGAIN_MS) { renewListeners() }
  }

  private var lastRenewMs = 0L

  private fun renewListeners() {
    if (!running || !listening) return
    lastRenewMs = scheduler.nowMs()
    Log.i(TAG, "Renewing drone listeners.")
    keys.cancelListen(listenHolder)
    sticks.removeVirtualStickStateListener(stickListener)
    removeHealthListener()
    listening = false
    startListening()
  }

  /** Owner of the key listeners; a new one each time they are renewed, so cancelling the old ones cannot touch the new. */
  private var listenHolder = Any()

  /** Backup to the listeners: read the SDK's latest values directly, once a second. */
  private fun readLatest() {
    try {
      keys.getValue(KeyTools.createKey(RemoteControllerKey.KeyConnection))?.let { rcConnected = it }
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyConnection))?.let { aircraftConnected = it }
      keys.getValue(KeyTools.createKey(BatteryKey.KeyChargeRemainingInPercent))?.let { battery = it }
    } catch (e: Exception) {
      Log.w(TAG, "Could not read drone values: ${e.message}")
    }
  }

  /** The same for what the flight needs fresh: position, heading and flying state, every tick. */
  private fun readFlightState(now: Long) {
    // A cached position only counts while both links are up (signalOk checks them too).
    if (!rcConnected || !aircraftConnected) return
    try {
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyAircraftLocation3D))?.let {
        location = it
        locationAtMs = now
      }
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyCompassHeading))?.let { compassHeading = it }
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyIsFlying))?.let { isFlying = it }
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyAreMotorsOn))?.let { motorsOn = it }
      keys.getValue(KeyTools.createKey(FlightControllerKey.KeyFlightMode))?.let { onFlightMode(it) }
    } catch (e: Exception) {
      if (now - lastReadWarnMs > 5000) {
        lastReadWarnMs = now
        Log.w(TAG, "Could not read flight state: ${e.message}")
      }
    }
  }

  private var lastReadWarnMs = 0L

  private var listening = false

  private fun startListening() {
    if (listening) return
    listening = true
    listenHolder = Any()
    listen(FlightControllerKey.KeyAircraftLocation3D) { if (it != null) { location = it; locationAtMs = scheduler.nowMs() } }
    listen(FlightControllerKey.KeyCompassHeading) { compassHeading = it ?: compassHeading }
    listen(FlightControllerKey.KeyFlightMode) { if (it != null) onFlightMode(it) }
    listen(FlightControllerKey.KeyLowBatteryRTHInfo) { lowBatteryInfo = it }
    listen(FlightControllerKey.KeyIsFlying) { if (it != null) isFlying = it }
    listen(FlightControllerKey.KeyAreMotorsOn) { if (it != null) motorsOn = it }
    listen(FlightControllerKey.KeyConnection) { aircraftConnected = it == true; Log.i(TAG, "Drone link: ${if (aircraftConnected) "connected" else "not connected"}") }
    listen(FlightControllerKey.KeyWindSpeed) { windSpeed = it }
    listen(FlightControllerKey.KeyWindDirection) { windDirection = it }
    listen(FlightControllerKey.KeyWindWarning) { windWarning = it }
    listen(RemoteControllerKey.KeyConnection) { rcConnected = it == true; Log.i(TAG, "Controller link: ${if (rcConnected) "connected" else "not connected"}") }
    listen(BatteryKey.KeyChargeRemainingInPercent) { battery = it }
    listen(ProductKey.KeyProductType) { productType = it?.name }
    listen(CameraKey.KeyNewlyGeneratedMediaFile) { onMediaFile(it) }
    sticks.setVirtualStickStateListener(stickListener)
    try {
      DeviceHealthManager.getInstance().addDJIDeviceHealthInfoChangeListener(healthListener)
    } catch (e: Exception) {
      Log.w(TAG, "Drone warnings not available: ${e.message}")
    }
    Log.i(TAG, "Listening to the drone.")
  }

  fun stop() = scheduler.post {
    running = false
    DjiSdk.removeConnectHook(onConnect)
    if (listening) {
      keys.cancelListen(listenHolder)
      sticks.removeVirtualStickStateListener(stickListener)
      removeHealthListener()
      listening = false
    }
    scheduler.cancelAll()
  }

  /** Commands need the SDK running; before that they are refused with a message instead of crashing. */
  private fun sdkReady(): Boolean {
    if (DjiSdk.initialized) return true
    status("error", "The DJI SDK is still starting. Wait a moment and try again.")
    return false
  }

  private val stickListener = object : VirtualStickStateListener {
    override fun onVirtualStickStateUpdate(state: VirtualStickState) = scheduler.post {
      virtualStickEnabled = state.isVirtualStickEnable
      authority = state.currentFlightControlAuthorityOwner
    }

    override fun onChangeReasonUpdate(reason: FlightControlAuthorityChangeReason) = scheduler.post {
      if (reason.name in TelemetryRules.PILOT_TAKEOVER_REASONS) {
        pilotTookOver = true
        target = null
        status("pilotTookOver", "Pilot has control (${reason.name}). The app will not take it back.")
      }
    }
  }

  // ---- Commands from FlightSession ---------------------------------------------------------------

  fun configureFailsafe(homeLat: Double, homeLng: Double, returnHeightM: Int, action: String) = scheduler.post {
    if (!sdkReady()) return@post
    failsafe = Failsafe.PENDING
    val failsafeAction = when (action) {
      "hover" -> FailsafeAction.HOVER
      "land" -> FailsafeAction.LANDING
      else -> FailsafeAction.GOHOME
    }
    var remaining = 3
    var failed = false
    val done = { what: String -> { error: IDJIError? ->
      scheduler.post {
        if (error != null && !failed) {
          failed = true
          failsafe = Failsafe.FAILED
          status("error", "Could not store the $what on the drone: ${error.text()}")
          if (takeoffRequestedAtMs != null) {
            takeoffRequestedAtMs = null
            status("error", "Take-off refused: the safety settings are not all stored on the drone.")
          }
        }
        remaining--
        if (remaining == 0 && !failed) {
          failsafe = Failsafe.CONFIGURED
          status("failsafeConfigured", "Home point, return height $returnHeightM m and signal-loss action stored on the drone.")
          if (takeoffRequestedAtMs != null) doTakeOff()
        }
      }
    } }
    setHomePoint(LocationCoordinate2D(homeLat, homeLng), ++failsafeRequest, HOME_POINT_TRIES, done("home point"))
    set(FlightControllerKey.KeyGoHomeHeight, returnHeightM, done("return height ($returnHeightM m)"))
    set(FlightControllerKey.KeyFailsafeAction, failsafeAction, done("signal-loss action"))
    // Photo mode for the scan; a failure here shows up later as failed photos.
    set(CameraKey.KeyCameraMode, CameraMode.PHOTO_NORMAL) { e ->
      if (e != null) status("warning", "Could not switch the camera to photo mode: ${e.text()}")
    }
  }

  private var failsafeRequest = 0

  /** Return or land asked for during take-off: the take-off is over, never hand control to the app after it. */
  private fun endAppTakeoff() {
    appTakeoffInProgress = false
    handingOverAtMs = null
    takeoffRequestedAtMs = null
  }

  /**
   * The drone refuses a new home point until it has recorded its own (a few seconds after it gets a
   * GPS fix, also in the simulator), so keep trying for a while before reporting the failure.
   */
  private fun setHomePoint(home: LocationCoordinate2D, request: Int, triesLeft: Int, done: (IDJIError?) -> Unit) {
    set(FlightControllerKey.KeyHomeLocation, home) { e ->
      when {
        request != failsafeRequest -> {} // superseded by a newer request
        e == null || triesLeft <= 1 -> done(e)
        else -> {
          if (triesLeft == HOME_POINT_TRIES) status("info", "Waiting for the drone to record its home point…")
          scheduler.postDelayed(1000) { if (request == failsafeRequest) setHomePoint(home, request, triesLeft - 1, done) }
        }
      }
    }
  }

  fun takeOff() = scheduler.post {
    if (!sdkReady()) return@post
    when (failsafe) {
      Failsafe.CONFIGURED -> doTakeOff()
      Failsafe.PENDING -> takeoffRequestedAtMs = scheduler.nowMs() // goes when the settings are stored
      else -> status("error", "Take-off refused: safety settings are not stored on the drone.")
    }
  }

  private fun doTakeOff() {
    takeoffRequestedAtMs = null
    pilotTookOver = false
    // Marked before the command is sent: the motors can start before DJI confirms it, and a
    // take-off the app did not ask for counts as the pilot flying.
    appTakeoffInProgress = true
    takeoffStartedAtMs = scheduler.nowMs()
    action(FlightControllerKey.KeyStartTakeoff) { e ->
      if (e != null) {
        appTakeoffInProgress = false
        status("error", "Take-off failed: ${e.text()}")
      }
    }
  }

  fun goTo(lat: Double, lng: Double, altitudeM: Double, speedMs: Double, headingDeg: Double?) = scheduler.post {
    if (!sdkReady()) return@post
    if (!appInControl()) return@post
    target = Target(lat, lng, altitudeM, speedMs, headingDeg)
  }

  fun hover() = scheduler.post { target = null }

  fun setGimbalPitch(deg: Double) = scheduler.post {
    if (!sdkReady()) return@post
    val rotation = GimbalAngleRotation().apply {
      mode = GimbalAngleRotationMode.ABSOLUTE_ANGLE
      pitch = deg
      roll = 0.0
      yaw = 0.0
      pitchIgnored = false
      rollIgnored = true
      yawIgnored = true
      duration = 1.0
      jointReferenceUsed = false
      timeout = 3
    }
    action(GimbalKey.KeyRotateByAngle, rotation) { e ->
      if (e != null) status("warning", "Gimbal did not move: ${e.text()}")
    }
  }

  fun takePhoto(waypointIndex: Int) = scheduler.post {
    if (!sdkReady()) return@post
    if (!appInControl()) {
      photoFailed(waypointIndex, "app does not have control")
      return@post
    }
    if (pendingPhoto != null) {
      photoFailed(waypointIndex, "camera busy")
      return@post
    }
    val photo = PendingPhoto(waypointIndex, scheduler.nowMs() + PHOTO_TIMEOUT_MS)
    pendingPhoto = photo
    action(CameraKey.KeyStartShootPhoto) { e ->
      if (pendingPhoto !== photo) return@action
      if (e != null) {
        pendingPhoto = null
        photoFailed(waypointIndex, e.text())
      } else {
        photo.shutterFired = true
      }
    }
  }

  fun returnHome() = scheduler.post {
    if (!sdkReady()) return@post
    target = null
    appAskedReturnAtMs = scheduler.nowMs()
    appRequested = "returning"
    endAppTakeoff()
    releaseSticksThen { action(FlightControllerKey.KeyStartGoHome) { e -> if (e != null) { appRequested = null; status("error", "Return to home failed: ${e.text()}. Use the controller's RTH button.") } } }
  }

  fun land() = scheduler.post {
    if (!sdkReady()) return@post
    target = null
    appAskedReturnAtMs = scheduler.nowMs()
    appRequested = "landing"
    endAppTakeoff()
    releaseSticksThen { action(FlightControllerKey.KeyStartAutoLanding) { e -> if (e != null) { appRequested = null; status("error", "Landing failed: ${e.text()}") } } }
  }

  // ---- Simulator ---------------------------------------------------------------------------------

  /**
   * Starts DJI's simulator with the drone on the ground at (lat, lng). If it is still running from
   * before, it is stopped first (so the drone starts again from there); the drone needs a moment
   * between the two, so starting is tried a few times.
   */
  fun enableSimulator(lat: Double, lng: Double, done: (String?) -> Unit) {
    if (!DjiSdk.initialized) return done("The DJI SDK is still starting. Wait a moment and try again.")
    val sim = SimulatorManager.getInstance()
    fun start(triesLeft: Int) {
      sim.enableSimulator(
        InitializationSettings.createInstance(LocationCoordinate2D(lat, lng), SIMULATOR_SATELLITES),
        completion { e ->
          if (e == null) done(null)
          else if (triesLeft > 1) {
            Log.w(TAG, "Simulator did not start (${e.text()}), trying again")
            scheduler.postDelayed(SIMULATOR_RETRY_MS) { start(triesLeft - 1) }
          } else done(e.text())
        },
      )
    }
    if (sim.isSimulatorEnabled) {
      Log.i(TAG, "Simulator still running: restarting it")
      sim.disableSimulator(completion { scheduler.postDelayed(SIMULATOR_RETRY_MS) { start(3) } })
    } else start(3)
  }

  fun disableSimulator(done: (String?) -> Unit) {
    if (!DjiSdk.initialized) return done(null)
    SimulatorManager.getInstance().disableSimulator(completion { e -> done(e?.text()) })
  }

  /** Simulator wind in m/s. The SDK takes whole numbers; which axis is north is checked in doc step S3. */
  fun setSimulatorWind(northMs: Double, eastMs: Double) {
    if (!DjiSdk.initialized) return
    SimulatorManager.getInstance().setWindSpeed(
      SimulatorWindInfo.Builder().windSpeedX(northMs.toInt()).windSpeedY(eastMs.toInt()).windSpeedZ(0).build(),
    )
  }

  // ---- The 10 Hz loop ----------------------------------------------------------------------------

  private fun tick() {
    if (!running) return
    val now = scheduler.nowMs()

    // Take-off finished: take control with virtual sticks so FlightSession can fly the mission.
    if (appTakeoffInProgress && isFlying && djiFlightMode != FlightMode.AUTO_TAKE_OFF && (location?.altitude ?: 0.0) > 0.8) {
      appTakeoffInProgress = false
      handingOverAtMs = now
      enableSticks()
    }
    // Still the app's take-off until virtual sticks are on; then the app is in control.
    handingOverAtMs?.let {
      if (appInControl()) handingOverAtMs = null
      else if (now - it > HANDOVER_WAIT_MS) {
        handingOverAtMs = null
        status("error", "Could not take control after take-off. Fly manually or press RTH.")
      }
    }
    // Take-off asked for but the drone never left the ground.
    if (appTakeoffInProgress && !isFlying && !motorsOn && now - takeoffStartedAtMs > TAKEOFF_WAIT_MS) {
      appTakeoffInProgress = false
      status("error", "Take-off did not start. Check the drone and try again.")
    }
    // Pending take-off waiting for safety settings for too long.
    takeoffRequestedAtMs?.let {
      if (now - it > TAKEOFF_WAIT_MS) {
        takeoffRequestedAtMs = null
        status("error", "Take-off refused: safety settings were not stored on the drone in time.")
      }
    }

    if (listening) readFlightState(now)
    // Both links up but no new position: the drone's flight data has not come back after a
    // reconnection (seen in test 7). Keep renewing the listeners until it does.
    if (listening && rcConnected && aircraftConnected && now - locationAtMs > STALE_POSITION_MS && now - lastRenewMs > RENEW_EVERY_MS) {
      Log.i(TAG, "No new position for ${(now - locationAtMs) / 1000}s with both links up.")
      renewListeners()
    }
    trackLinkLoss(now)
    sendSticks(now)
    pendingPhoto?.let { if (now > it.deadlineMs) { pendingPhoto = null; photoFailed(it.waypointIndex, "no photo reported by the camera") } }
    emitTelemetry(now)
    scheduler.postDelayed(TICK_MS) { tick() }
  }

  private fun sendSticks(now: Long) {
    // While the drone flies home or lands by itself, never steer against it.
    if (droneFlyingItself()) target = null
    if (!appInControl() || droneFlyingItself()) {
      goTo.reset()
      return
    }
    val loc = location ?: return
    val out = goTo.update(Position(loc.latitude, loc.longitude, loc.altitude), compassHeading, target, now)
    if (out.fault != null) {
      target = null
      status("error", out.fault)
    }
    // While a photo is being taken, hold still.
    send(if (pendingPhoto != null) StickCommand.hold(compassHeading) else out.command)
  }

  private fun send(c: StickCommand) {
    val param = VirtualStickFlightControlParam().apply {
      rollPitchCoordinateSystem = FlightCoordinateSystem.GROUND
      rollPitchControlMode = RollPitchControlMode.VELOCITY
      verticalControlMode = VerticalControlMode.VELOCITY
      yawControlMode = dji.sdk.keyvalue.value.flightcontroller.YawControlMode.ANGLE
      // Ground frame: assumed pitch = east, roll = north. Checked in doc step S2; the
      // GoToController guard stops the drone if this is wrong.
      pitch = c.eastMs
      roll = c.northMs
      yaw = c.yawDeg
      verticalThrottle = c.upMs
    }
    sticks.sendVirtualStickAdvancedParam(param)
  }

  private fun enableSticks() {
    if (pilotTookOver) return
    sticks.enableVirtualStick(completion { e ->
      if (e != null) {
        handingOverAtMs = null
        status("error", "Could not take control after take-off: ${e.text()}. Fly manually or press RTH.")
      }
      else sticks.setVirtualStickAdvancedModeEnabled(true)
    })
  }

  private fun releaseSticksThen(next: () -> Unit) {
    if (!virtualStickEnabled) return next()
    sticks.disableVirtualStick(completion { next() })
  }

  // The drone's own warnings (the ones DJI Fly shows at the top of the screen).
  private var warnings: List<String> = emptyList()

  private val healthListener = DJIDeviceHealthInfoChangeListener { infos ->
    scheduler.post {
      val now = infos.orEmpty().map { i ->
        listOf(i.title(), i.description()).filter { !it.isNullOrBlank() }.distinct().joinToString(": ").ifBlank { "code ${i.informationCode()}" } +
          " [${i.informationCode()}, ${i.warningLevel()?.name}]"
      }
      for (w in now - warnings.toSet()) status("droneWarning", "Drone warning: $w")
      warnings = now
    }
  }

  private fun removeHealthListener() {
    try { DeviceHealthManager.getInstance().removeDJIDeviceHealthInfoChangeListener(healthListener) } catch (_: Exception) {}
  }

  private fun droneFlyingItself(): Boolean =
    djiFlightMode == FlightMode.GO_HOME || djiFlightMode == FlightMode.AUTO_LANDING || djiFlightMode == FlightMode.FORCE_LANDING

  private var lowBatteryInfo: dji.sdk.keyvalue.value.flightcontroller.LowBatteryRTHInfo? = null
  private var appAskedReturnAtMs = 0L
  private var appRequested: String? = null

  /** The app's return or landing, for up to 10 s until the drone's mode shows it (then the drone's mode counts). */
  private fun pendingRequest(now: Long): String? {
    val req = appRequested ?: return null
    if (droneFlyingItself() || now - appAskedReturnAtMs > REQUEST_WAIT_MS) {
      appRequested = null
      return null
    }
    return req
  }

  private fun onFlightMode(mode: FlightMode?) {
    val was = djiFlightMode
    djiFlightMode = mode
    if (mode == was) return
    Log.i(TAG, "Drone flight mode: ${was?.name} -> ${mode?.name}")
    // The drone started its own Return to Home: record what it knew, to find out why.
    if (mode == FlightMode.GO_HOME && scheduler.nowMs() - appAskedReturnAtMs > 5000) {
      val b = lowBatteryInfo
      val why = buildString {
        append("battery ${battery ?: "?"}%")
        b?.batteryPercentNeededToGoHome?.let { append(", needs $it% to get home") }
        b?.lowBatteryRTHStatus?.let { append(", low-battery return ${it.name}") }
        b?.remainingFlightTime?.let { append(", ${it}s flight time left") }
        append(", controller ${if (rcConnected) "connected" else "NOT connected"}")
        append(", drone link ${if (aircraftConnected) "up" else "DOWN"}")
        if (warnings.isNotEmpty()) append("; drone warnings: ${warnings.joinToString("; ")}")
      }
      status("droneReturning", "Return to Home started outside the app, by the drone or the controller button ($why).")
    }
  }

  // The app had the sticks and lost them because the link went (cable out, controller off), not
  // because the pilot took over: the drone holds position by itself. That still counts as the app's
  // flight ("app"), so when the link is back FlightSession brings the drone home (it does not
  // retake the sticks). The pilot can still stop that with the controller's Pause button.
  private var hadSticks = false
  private var sticksLostToLink = false
  private var linkDownAtMs = -1_000_000L
  private var sticksLostAtMs = -1_000_000L

  private fun trackLinkLoss(now: Long) {
    val linkUp = DjiSdk.productConnected && rcConnected && aircraftConnected
    if (!linkUp) linkDownAtMs = now
    val inControl = appInControl()
    if (hadSticks && !inControl && !pilotTookOver && appRequested == null) sticksLostAtMs = now
    // The sticks and the link went within 3 s of each other (either can be reported first).
    if (!sticksLostToLink && !inControl && !pilotTookOver && appRequested == null &&
      now - sticksLostAtMs < 3000 && now - linkDownAtMs < 3000
    ) {
      Log.i(TAG, "App lost the sticks with the link; the drone is holding position by itself.")
      sticksLostToLink = true
    }
    if (inControl || pilotTookOver || appRequested != null || (!isFlying && !motorsOn) || droneFlyingItself()) sticksLostToLink = false
    hadSticks = inControl
  }

  private fun appInControl(): Boolean =
    virtualStickEnabled && authority == FlightControlAuthority.MSDK && !pilotTookOver

  private var lastLogMs = 0L
  private var lastReadMs = 0L
  private var emitFailed = false

  private fun emitTelemetry(now: Long) {
    // A short summary in the phone's log every 5 seconds, to see what is and is not connected.
    if (listening && now - lastReadMs >= 1000) {
      lastReadMs = now
      readLatest()
    }
    if (now - lastLogMs >= 5000) {
      lastLogMs = now
      Log.i(TAG, "Telemetry: listening=$listening controller=$rcConnected drone=$aircraftConnected gps=${location != null} positionAge=${if (location == null) "-" else "${(now - locationAtMs) / 1000}s"} flying=$isFlying motors=$motorsOn battery=$battery product=$productType wind=$windSpeed/${windDirection?.name}/${windWarning?.name} mode=${djiFlightMode?.name}")
    }
    try {
      sendTelemetry(now)
      if (emitFailed) Log.i(TAG, "Telemetry sending again.")
      emitFailed = false
    } catch (e: Exception) {
      if (!emitFailed) Log.e(TAG, "Could not send telemetry to the app", e)
      emitFailed = true
    }
  }

  private fun sendTelemetry(now: Long) {
    val loc = location
    emit(
      "onTelemetry",
      mapOf(
        "lat" to loc?.latitude,
        "lng" to loc?.longitude,
        "altitudeM" to (loc?.altitude ?: 0.0),
        "batteryPercent" to battery,
        "flightMode" to TelemetryRules.flightMode(djiFlightMode?.name, isFlying, motorsOn, appInControl() || sticksLostToLink, appTakeoffInProgress || handingOverAtMs != null, pendingRequest(now)),
        "signalOk" to TelemetryRules.signalOk(rcConnected, aircraftConnected, now - locationAtMs),
        "windSpeedMs" to TelemetryRules.windSpeedMs(windSpeed),
        "windFromDeg" to TelemetryRules.windDirectionDeg(windDirection?.name),
        "windWarning" to TelemetryRules.windWarning(windWarning?.name),
        "headingDeg" to compassHeading,
        "productType" to productType,
        "djiFlightMode" to djiFlightMode?.name,
        "pilotTookOver" to pilotTookOver,
        "rcConnected" to rcConnected,
        "aircraftConnected" to aircraftConnected,
        "sdkListening" to listening,
      ),
    )
  }

  private fun onMediaFile(info: GeneratedMediaFileInfo?) {
    val photo = pendingPhoto ?: return
    if (info == null || !photo.shutterFired) return
    pendingPhoto = null
    emit(
      "onDroneEvent",
      mapOf("type" to "photoTaken", "waypointIndex" to photo.waypointIndex, "file" to "${info.dir_no}/${info.file_no}"),
    )
  }

  private fun photoFailed(index: Int, reason: String) =
    emit("onDroneEvent", mapOf("type" to "photoFailed", "waypointIndex" to index, "reason" to reason))

  private fun status(kind: String, message: String) = emit("onStatus", mapOf("kind" to kind, "message" to message))

  // ---- DJI key helpers ---------------------------------------------------------------------------

  private fun <T> listen(info: DJIKeyInfo<T>, onChange: (T?) -> Unit) {
    val key: DJIKey<T> = KeyTools.createKey(info)
    keys.listen(key, listenHolder, true, CommonCallbacks.KeyListener<T> { _, value -> scheduler.post { onChange(value) } })
  }

  private fun <T> set(info: DJIKeyInfo<T>, value: T, done: (IDJIError?) -> Unit) {
    keys.setValue(KeyTools.createKey(info), value, completion(done))
  }

  private fun action(info: dji.sdk.keyvalue.key.DJIActionKeyInfo<EmptyMsg, EmptyMsg>, done: (IDJIError?) -> Unit) {
    keys.performAction(KeyTools.createKey(info), param(done))
  }

  private fun <P> action(info: dji.sdk.keyvalue.key.DJIActionKeyInfo<P, EmptyMsg>, value: P, done: (IDJIError?) -> Unit) {
    keys.performAction(KeyTools.createKey(info), value, param(done))
  }

  private fun completion(done: (IDJIError?) -> Unit) = object : CommonCallbacks.CompletionCallback {
    override fun onSuccess() = scheduler.post { done(null) }
    override fun onFailure(error: IDJIError) = scheduler.post { done(error) }
  }

  private fun param(done: (IDJIError?) -> Unit) = object : CommonCallbacks.CompletionCallbackWithParam<EmptyMsg> {
    override fun onSuccess(result: EmptyMsg?) = scheduler.post { done(null) }
    override fun onFailure(error: IDJIError) = scheduler.post { done(error) }
  }

  companion object {
    const val TAG = "DjiDrone"
    const val TICK_MS = 100L
    const val PHOTO_TIMEOUT_MS = 5000L
    const val TAKEOFF_WAIT_MS = 30_000L
    const val HANDOVER_WAIT_MS = 5_000L
    const val HOME_POINT_TRIES = 20
    const val REQUEST_WAIT_MS = 10_000L
    const val SIMULATOR_RETRY_MS = 2_000L
    const val RELISTEN_AGAIN_MS = 3_000L
    const val STALE_POSITION_MS = 3_000L
    const val RENEW_EVERY_MS = 5_000L
    const val SIMULATOR_SATELLITES = 15
  }
}
