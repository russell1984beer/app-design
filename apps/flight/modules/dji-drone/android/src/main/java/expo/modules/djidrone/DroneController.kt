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
  }

  private var listening = false

  private fun startListening() {
    if (listening) return
    listening = true
    listen(FlightControllerKey.KeyAircraftLocation3D) { location = it; locationAtMs = scheduler.nowMs() }
    listen(FlightControllerKey.KeyCompassHeading) { compassHeading = it ?: compassHeading }
    listen(FlightControllerKey.KeyFlightMode) { djiFlightMode = it }
    listen(FlightControllerKey.KeyIsFlying) { isFlying = it == true }
    listen(FlightControllerKey.KeyAreMotorsOn) { motorsOn = it == true }
    listen(FlightControllerKey.KeyConnection) { aircraftConnected = it == true; Log.i(TAG, "Drone link: ${if (aircraftConnected) "connected" else "not connected"}") }
    listen(FlightControllerKey.KeyWindSpeed) { windSpeed = it }
    listen(FlightControllerKey.KeyWindDirection) { windDirection = it }
    listen(FlightControllerKey.KeyWindWarning) { windWarning = it }
    listen(RemoteControllerKey.KeyConnection) { rcConnected = it == true; Log.i(TAG, "Controller link: ${if (rcConnected) "connected" else "not connected"}") }
    listen(BatteryKey.KeyChargeRemainingInPercent) { battery = it }
    listen(ProductKey.KeyProductType) { productType = it?.name }
    listen(CameraKey.KeyNewlyGeneratedMediaFile) { onMediaFile(it) }
    sticks.setVirtualStickStateListener(stickListener)
    Log.i(TAG, "Listening to the drone.")
  }

  fun stop() = scheduler.post {
    running = false
    if (listening) {
      keys.cancelListen(this)
      sticks.removeVirtualStickStateListener(stickListener)
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
    val done = { error: IDJIError? ->
      scheduler.post {
        if (error != null && !failed) {
          failed = true
          failsafe = Failsafe.FAILED
          status("error", "Could not store safety settings on the drone: ${error.description()}")
        }
        remaining--
        if (remaining == 0 && !failed) {
          failsafe = Failsafe.CONFIGURED
          status("failsafeConfigured", "Home point, return height $returnHeightM m and signal-loss action stored on the drone.")
          if (takeoffRequestedAtMs != null) doTakeOff()
        }
      }
    }
    set(FlightControllerKey.KeyHomeLocation, LocationCoordinate2D(homeLat, homeLng), done)
    set(FlightControllerKey.KeyGoHomeHeight, returnHeightM, done)
    set(FlightControllerKey.KeyFailsafeAction, failsafeAction, done)
    // Photo mode for the scan; a failure here shows up later as failed photos.
    set(CameraKey.KeyCameraMode, CameraMode.PHOTO_NORMAL) { e ->
      if (e != null) status("warning", "Could not switch the camera to photo mode: ${e.description()}")
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
    action(FlightControllerKey.KeyStartTakeoff) { e ->
      if (e == null) appTakeoffInProgress = true
      else status("error", "Take-off failed: ${e.description()}")
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
      if (e != null) status("warning", "Gimbal did not move: ${e.description()}")
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
        photoFailed(waypointIndex, e.description())
      } else {
        photo.shutterFired = true
      }
    }
  }

  fun returnHome() = scheduler.post {
    if (!sdkReady()) return@post
    target = null
    releaseSticksThen { action(FlightControllerKey.KeyStartGoHome) { e -> if (e != null) status("error", "Return to home failed: ${e.description()}. Use the controller's RTH button.") } }
  }

  fun land() = scheduler.post {
    if (!sdkReady()) return@post
    target = null
    releaseSticksThen { action(FlightControllerKey.KeyStartAutoLanding) { e -> if (e != null) status("error", "Landing failed: ${e.description()}") } }
  }

  // ---- Simulator ---------------------------------------------------------------------------------

  fun enableSimulator(lat: Double, lng: Double, done: (String?) -> Unit) {
    if (!DjiSdk.initialized) return done("The DJI SDK is still starting. Wait a moment and try again.")
    SimulatorManager.getInstance().enableSimulator(
      InitializationSettings.createInstance(LocationCoordinate2D(lat, lng), SIMULATOR_SATELLITES),
      completion { e -> done(e?.description()) },
    )
  }

  fun disableSimulator(done: (String?) -> Unit) {
    if (!DjiSdk.initialized) return done(null)
    SimulatorManager.getInstance().disableSimulator(completion { e -> done(e?.description()) })
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
      enableSticks()
    }
    // Pending take-off waiting for safety settings for too long.
    takeoffRequestedAtMs?.let {
      if (now - it > TAKEOFF_WAIT_MS) {
        takeoffRequestedAtMs = null
        status("error", "Take-off refused: safety settings were not stored on the drone in time.")
      }
    }

    sendSticks(now)
    pendingPhoto?.let { if (now > it.deadlineMs) { pendingPhoto = null; photoFailed(it.waypointIndex, "no photo reported by the camera") } }
    emitTelemetry(now)
    scheduler.postDelayed(TICK_MS) { tick() }
  }

  private fun sendSticks(now: Long) {
    if (!appInControl()) {
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
      if (e != null) status("error", "Could not take control after take-off: ${e.description()}. Fly manually or press RTH.")
      else sticks.setVirtualStickAdvancedModeEnabled(true)
    })
  }

  private fun releaseSticksThen(next: () -> Unit) {
    if (!virtualStickEnabled) return next()
    sticks.disableVirtualStick(completion { next() })
  }

  private fun appInControl(): Boolean =
    virtualStickEnabled && authority == FlightControlAuthority.MSDK && !pilotTookOver

  private var lastLogMs = 0L
  private var emitFailed = false

  private fun emitTelemetry(now: Long) {
    // A short summary in the phone's log every 5 seconds, to see what is and is not connected.
    if (now - lastLogMs >= 5000) {
      lastLogMs = now
      Log.i(TAG, "Telemetry: listening=$listening controller=$rcConnected drone=$aircraftConnected gps=${location != null} battery=$battery product=$productType")
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
        "flightMode" to TelemetryRules.flightMode(djiFlightMode?.name, isFlying, motorsOn, appInControl(), appTakeoffInProgress),
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
    keys.listen(key, this, true, CommonCallbacks.KeyListener<T> { _, value -> scheduler.post { onChange(value) } })
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
    const val TAKEOFF_WAIT_MS = 10_000L
    const val SIMULATOR_SATELLITES = 15
  }
}
