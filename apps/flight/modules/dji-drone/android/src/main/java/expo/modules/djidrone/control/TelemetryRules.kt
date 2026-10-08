package expo.modules.djidrone.control

// How raw DJI state becomes the flight-core telemetry fields. Pure Kotlin: DJI enums are passed
// in by name so these rules can be unit-tested without the SDK.

object TelemetryRules {
  /** Link to the drone is good: controller and aircraft connected and fresh position data. */
  const val STALE_AFTER_MS = 2000L

  fun signalOk(rcConnected: Boolean, aircraftConnected: Boolean, msSinceLocation: Long): Boolean =
    rcConnected && aircraftConnected && msSinceLocation < STALE_AFTER_MS

  /**
   * The flight-core flight mode. Anything airborne that the app is not controlling counts as the
   * pilot's, so the app never assumes control it does not have.
   */
  fun flightMode(
    djiFlightMode: String?,
    isFlying: Boolean,
    motorsOn: Boolean,
    appInControl: Boolean,
    appTakeoffInProgress: Boolean,
  ): String {
    if (!isFlying && !motorsOn) return "onGround"
    return when (djiFlightMode) {
      "GO_HOME" -> "returning"
      "AUTO_LANDING", "FORCE_LANDING", "ATTI_LANDING" -> "landing"
      "AUTO_TAKE_OFF", "MOTOR_START", "TAKE_OFF_READY" -> if (appTakeoffInProgress) "takingOff" else "pilot"
      else -> when {
        appInControl -> "app"
        appTakeoffInProgress -> "takingOff"
        !isFlying -> "onGround"
        else -> "pilot"
      }
    }
  }

  /** Reasons the drone took control away from the app that mean the pilot has taken over. */
  val PILOT_TAKEOVER_REASONS = setOf("RC_PAUSE_STOP", "RC_SWITCH", "RC_NOT_P_MODE")

  fun windWarning(djiLevel: String?): String = when (djiLevel) {
    "LEVEL_1" -> "moderate"
    "LEVEL_2" -> "strong"
    else -> "none"
  }

  /** DJI wind direction names to a compass bearing; null when unknown or calm. */
  fun windDirectionDeg(djiDirection: String?): Double? = when (djiDirection) {
    "NORTH" -> 0.0
    "NORTH_EAST" -> 45.0
    "EAST" -> 90.0
    "SOUTH_EAST" -> 135.0
    "SOUTH" -> 180.0
    "SOUTH_WEST" -> 225.0
    "WEST" -> 270.0
    "NORTH_WEST" -> 315.0
    else -> null
  }

  /**
   * DJI reports wind speed as an integer. The SDK does not document the unit in the published
   * files; it is assumed to be decimetres per second. Check this in the simulator (doc step S3).
   */
  fun windSpeedMs(djiWindSpeed: Int?): Double? = djiWindSpeed?.let { it / 10.0 }
}
