package expo.modules.djidrone

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JavaScript entry point. Thin: all behaviour lives in DroneController and DjiSdk. */
class DjiDroneModule : Module() {
  private var controller: DroneController? = null

  private val mainScheduler = object : Scheduler {
    private val handler = Handler(Looper.getMainLooper())
    override fun post(task: () -> Unit) { handler.post(task) }
    override fun postDelayed(delayMs: Long, task: () -> Unit) { handler.postDelayed(task, delayMs) }
    override fun cancelAll() { handler.removeCallbacksAndMessages(null) }
    override fun nowMs(): Long = SystemClock.elapsedRealtime()
  }

  override fun definition() = ModuleDefinition {
    Name("DjiDrone")
    Events("onTelemetry", "onDroneEvent", "onStatus")

    OnCreate {
      DjiSdk.onStatus = { kind, message -> sendEvent("onStatus", mapOf("kind" to kind, "message" to message)) }
      controller = DroneController(mainScheduler) { name, body -> sendEvent(name, body) }.also { it.start() }
    }

    OnDestroy {
      DjiSdk.onStatus = null
      controller?.stop()
      controller = null
    }

    Function("getStatus") {
      val last = DjiSdk.lastStatus()
      mapOf(
        "registered" to DjiSdk.registered,
        "productConnected" to DjiSdk.productConnected,
        "lastKind" to last?.first,
        "lastMessage" to last?.second,
      )
    }

    Function("configureFailsafe") { homeLat: Double, homeLng: Double, returnHeightM: Int, action: String ->
      controller?.configureFailsafe(homeLat, homeLng, returnHeightM, action)
    }
    Function("takeOff") { controller?.takeOff() }
    Function("goTo") { lat: Double, lng: Double, altitudeM: Double, speedMs: Double, headingDeg: Double? ->
      controller?.goTo(lat, lng, altitudeM, speedMs, headingDeg)
    }
    Function("setGimbalPitch") { deg: Double -> controller?.setGimbalPitch(deg) }
    Function("takePhoto") { waypointIndex: Int -> controller?.takePhoto(waypointIndex) }
    Function("hover") { controller?.hover() }
    Function("returnHome") { controller?.returnHome() }
    Function("land") { controller?.land() }

    AsyncFunction("enableSimulator") { lat: Double, lng: Double, promise: Promise ->
      val c = controller ?: return@AsyncFunction promise.reject("NO_CONTROLLER", "Drone module not ready", null)
      c.enableSimulator(lat, lng) { error -> if (error == null) promise.resolve(null) else promise.reject("SIMULATOR", error, null) }
    }
    AsyncFunction("disableSimulator") { promise: Promise ->
      val c = controller ?: return@AsyncFunction promise.reject("NO_CONTROLLER", "Drone module not ready", null)
      c.disableSimulator { error -> if (error == null) promise.resolve(null) else promise.reject("SIMULATOR", error, null) }
    }
    AsyncFunction("formatStorage") { promise: Promise ->
      val c = controller ?: return@AsyncFunction promise.reject("NO_CONTROLLER", "Drone module not ready", null)
      c.formatStorage { error -> if (error == null) promise.resolve(null) else promise.reject("FORMAT", error, null) }
    }
    AsyncFunction("getFlyZones") { lat: Double, lng: Double, promise: Promise ->
      FlyZones.around(lat, lng) { zones, error -> if (zones != null) promise.resolve(zones) else promise.reject("FLYSAFE", error, null) }
    }
    Function("setSimulatorWind") { northMs: Double, eastMs: Double -> controller?.setSimulatorWind(northMs, eastMs) }
  }
}
