package expo.modules.djidrone.control

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// Turns "fly to this point" into velocity commands for DJI virtual sticks, ten times a second.
// Pure Kotlin with no DJI or Android types, so it can be unit-tested on any computer.

data class Position(val lat: Double, val lng: Double, val altitudeM: Double)

data class Target(
  val lat: Double,
  val lng: Double,
  val altitudeM: Double,
  val speedMs: Double,
  /** Compass heading to face; null keeps the current heading. */
  val headingDeg: Double?,
)

/** Velocities in the ground frame: north and east in m/s, up in m/s, yaw as an absolute compass angle. */
data class StickCommand(val northMs: Double, val eastMs: Double, val upMs: Double, val yawDeg: Double) {
  companion object {
    fun hold(headingDeg: Double) = StickCommand(0.0, 0.0, 0.0, GoToController.toDjiYaw(headingDeg))
  }
}

data class ControlOutput(
  val command: StickCommand,
  /** Within ARRIVED distance and height of the target. */
  val arrived: Boolean,
  /** Set when the drone is not moving the way it is told: stop and hand back to the pilot. */
  val fault: String?,
)

class GoToController(
  private val maxClimbMs: Double = 3.0,
  private val maxDescentMs: Double = 2.0,
  private val maxSpeedMs: Double = 8.0,
  /** Start slowing down this far from the target. */
  private val slowRadiusM: Double = 4.0,
) {
  private val history = ArrayDeque<Pair<Long, Double>>()
  private var lastTarget: Target? = null

  fun update(pos: Position, headingDeg: Double, target: Target?, nowMs: Long): ControlOutput {
    if (target == null) {
      reset()
      return ControlOutput(StickCommand.hold(headingDeg), arrived = true, fault = null)
    }
    if (target != lastTarget) {
      history.clear()
      lastTarget = target
    }

    val (north, east) = offsetM(pos, target)
    val distance = hypot(north, east)
    val dz = target.altitudeM - pos.altitudeM
    val arrived = distance < ARRIVED_M && abs(dz) < ARRIVED_ALT_M

    val cruise = min(target.speedMs, maxSpeedMs)
    // Slow down smoothly near the target, but not so much that it never gets there.
    val speed = if (arrived) 0.0 else max(MIN_SPEED_MS, min(cruise, cruise * distance / slowRadiusM))
    val northMs = if (distance > 1e-6 && !arrived) north / distance * speed else 0.0
    val eastMs = if (distance > 1e-6 && !arrived) east / distance * speed else 0.0
    val upMs = if (abs(dz) < ARRIVED_ALT_M) 0.0 else (dz * 0.8).coerceIn(-maxDescentMs, maxClimbMs)
    val yaw = toDjiYaw(target.headingDeg ?: headingDeg)

    val fault = checkFollowing(distance, speed, nowMs)
    if (fault != null) return ControlOutput(StickCommand.hold(headingDeg), arrived = false, fault = fault)
    return ControlOutput(StickCommand(northMs, eastMs, upMs, yaw), arrived, null)
  }

  fun reset() {
    history.clear()
    lastTarget = null
  }

  /**
   * Guard against the drone going the wrong way (for example if north and east were swapped):
   * if it has been told to move for a few seconds and is now clearly further away than its
   * closest point in that time, something is wrong.
   */
  private fun checkFollowing(distance: Double, speed: Double, nowMs: Long): String? {
    if (speed < 0.5 || distance < DIVERGE_IGNORE_M) {
      history.clear()
      return null
    }
    history.addLast(nowMs to distance)
    while (history.isNotEmpty() && nowMs - history.first().first > DIVERGE_WINDOW_MS) history.removeFirst()
    if (nowMs - history.first().first < DIVERGE_WINDOW_MS / 2) return null
    val closest = history.minOf { it.second }
    return if (distance > closest + DIVERGE_M) {
      "Drone is moving away from its target (${"%.1f".format(distance)} m, was ${"%.1f".format(closest)} m). Stopped."
    } else {
      null
    }
  }

  companion object {
    const val ARRIVED_M = 0.3
    const val ARRIVED_ALT_M = 0.2
    const val MIN_SPEED_MS = 0.3
    const val DIVERGE_M = 2.0
    const val DIVERGE_WINDOW_MS = 4000L
    const val DIVERGE_IGNORE_M = 3.0
    private const val EARTH_RADIUS_M = 6_371_000.0

    /** North and east offset from a position to a target, metres. Flat-earth: fine over a garden. */
    fun offsetM(from: Position, to: Target): Pair<Double, Double> {
      val rad = Math.PI / 180
      val north = (to.lat - from.lat) * rad * EARTH_RADIUS_M
      val east = (to.lng - from.lng) * rad * EARTH_RADIUS_M * cos(from.lat * rad)
      return north to east
    }

    /** DJI yaw angles run from -180 to 180. */
    fun toDjiYaw(headingDeg: Double): Double {
      val h = ((headingDeg % 360) + 360) % 360
      return if (h > 180) h - 360 else h
    }
  }
}
