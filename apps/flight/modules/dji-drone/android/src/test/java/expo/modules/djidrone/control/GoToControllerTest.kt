package expo.modules.djidrone.control

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GoToControllerTest {
  private val home = Position(52.0, -1.0, 0.0)

  /** A point `north` and `east` metres from home. */
  private fun at(north: Double, east: Double, alt: Double, speed: Double = 4.0, heading: Double? = null): Target {
    val rad = Math.PI / 180
    return Target(
      home.lat + north / (6_371_000.0 * rad),
      home.lng + east / (6_371_000.0 * rad * cos(home.lat * rad)),
      alt,
      speed,
      heading,
    )
  }

  /** Simple drone: does exactly what the sticks say. `swapAxes` mimics getting north and east the wrong way round. */
  private class ToyDrone(var pos: Position, val swapAxes: Boolean = false) {
    fun step(c: StickCommand, dt: Double) {
      val n = if (swapAxes) c.eastMs else c.northMs
      val e = if (swapAxes) c.northMs else c.eastMs
      val rad = Math.PI / 180
      pos = Position(
        pos.lat + n * dt / (6_371_000.0 * rad),
        pos.lng + e * dt / (6_371_000.0 * rad * cos(pos.lat * rad)),
        pos.altitudeM + c.upMs * dt,
      )
    }
  }

  private fun fly(drone: ToyDrone, target: Target, seconds: Double): Pair<ControlOutput, Int> {
    val ctl = GoToController()
    var out = ctl.update(drone.pos, 0.0, target, 0)
    var t = 0L
    var steps = 0
    while (t < seconds * 1000 && !out.arrived && out.fault == null) {
      drone.step(out.command, 0.1)
      t += 100
      steps++
      out = ctl.update(drone.pos, 0.0, target, t)
    }
    return out to steps
  }

  @Test
  fun `flies to a point and arrives`() {
    val drone = ToyDrone(home.copy(altitudeM = 30.0))
    val target = at(20.0, -15.0, 30.0)
    val (out, steps) = fly(drone, target, 60.0)
    assertTrue(out.arrived)
    assertNull(out.fault)
    val (n, e) = GoToController.offsetM(drone.pos, target)
    assertTrue(hypot(n, e) < GoToController.ARRIVED_M)
    // 25 m at 4 m/s plus slowing down: well under 20 s.
    assertTrue(steps < 200, "took $steps steps")
  }

  @Test
  fun `climbs and descends to the target height`() {
    val up = ToyDrone(home.copy(altitudeM = 1.2))
    assertTrue(fly(up, at(0.0, 0.0, 30.0), 30.0).first.arrived)
    assertTrue(abs(up.pos.altitudeM - 30.0) < GoToController.ARRIVED_ALT_M)
    val down = ToyDrone(home.copy(altitudeM = 30.0))
    assertTrue(fly(down, at(0.0, 0.0, 12.0), 30.0).first.arrived)
  }

  @Test
  fun `never exceeds the requested speed or climb limits`() {
    val ctl = GoToController()
    val out = ctl.update(home, 0.0, at(100.0, 100.0, 80.0, speed = 5.0), 0)
    assertTrue(hypot(out.command.northMs, out.command.eastMs) <= 5.0 + 1e-9)
    assertTrue(out.command.upMs <= 3.0)
    val fast = ctl.update(home, 0.0, at(100.0, 0.0, 0.0, speed = 50.0), 0)
    assertTrue(fast.command.northMs <= 8.0 + 1e-9)
  }

  @Test
  fun `stops and reports a fault if the drone goes the wrong way`() {
    // Target to the north-west: swapped axes send the drone south-east, away from it.
    val drone = ToyDrone(home.copy(altitudeM = 30.0), swapAxes = true)
    val (out, _) = fly(drone, at(30.0, -30.0, 30.0), 30.0)
    assertNotNull(out.fault)
    assertEquals(0.0, out.command.northMs)
    assertEquals(0.0, out.command.eastMs)
  }

  @Test
  fun `no target means hold position`() {
    val out = GoToController().update(home, 90.0, null, 0)
    assertEquals(StickCommand(0.0, 0.0, 0.0, 90.0), out.command)
  }

  @Test
  fun `faces the requested heading using DJI's -180 to 180 range`() {
    assertEquals(-90.0, GoToController().update(home, 0.0, at(10.0, 0.0, 0.0, heading = 270.0), 0).command.yawDeg)
    assertEquals(135.0, GoToController.toDjiYaw(135.0))
    assertEquals(-45.0, GoToController.toDjiYaw(315.0))
    assertEquals(0.0, GoToController.toDjiYaw(360.0))
  }
}

class TelemetryRulesTest {
  @Test
  fun `signal is lost when either link drops or data goes stale`() {
    assertTrue(TelemetryRules.signalOk(true, true, 100))
    assertTrue(!TelemetryRules.signalOk(false, true, 100))
    assertTrue(!TelemetryRules.signalOk(true, false, 100))
    assertTrue(!TelemetryRules.signalOk(true, true, 5000))
  }

  @Test
  fun `flight modes`() {
    val m = { mode: String, flying: Boolean, motors: Boolean, app: Boolean, takeoff: Boolean ->
      TelemetryRules.flightMode(mode, flying, motors, app, takeoff)
    }
    assertEquals("onGround", m("GPS_NORMAL", false, false, false, false))
    assertEquals("takingOff", m("AUTO_TAKE_OFF", true, true, false, true))
    assertEquals("takingOff", m("GPS_NORMAL", true, true, false, true))
    assertEquals("app", m("VIRTUAL_STICK", true, true, true, false))
    assertEquals("returning", m("GO_HOME", true, true, false, false))
    assertEquals("landing", m("AUTO_LANDING", true, true, false, false))
    // Flying but not under app control: the pilot has it.
    assertEquals("pilot", m("GPS_NORMAL", true, true, false, false))
    assertEquals("pilot", m("AUTO_TAKE_OFF", true, true, false, false))
    // The app has just asked for Return to Home: not the pilot while the drone switches over.
    assertEquals("returning", TelemetryRules.flightMode("GPS_NORMAL", true, true, false, false, "returning"))
    assertEquals("returning", TelemetryRules.flightMode("AUTO_TAKE_OFF", true, true, false, false, "returning"))
    assertEquals("landing", TelemetryRules.flightMode("GPS_NORMAL", true, true, false, false, "landing"))
  }

  @Test
  fun `wind`() {
    assertEquals("strong", TelemetryRules.windWarning("LEVEL_2"))
    assertEquals("none", TelemetryRules.windWarning("UNKNOWN"))
    assertEquals(225.0, TelemetryRules.windDirectionDeg("SOUTH_WEST"))
    assertNull(TelemetryRules.windDirectionDeg("WINDLESS"))
    assertEquals(8.5, TelemetryRules.windSpeedMs(85))
  }
}
