package expo.modules.djidrone

import android.os.Handler
import android.os.Looper
import dji.sdk.keyvalue.value.common.LocationCoordinate2D
import dji.v5.common.callback.CommonCallbacks
import dji.v5.common.error.IDJIError
import dji.v5.manager.aircraft.flysafe.FlyZoneManager
import dji.v5.manager.aircraft.flysafe.info.FlyZoneInformation
import dji.v5.manager.aircraft.flysafe.info.FlyZoneShape

/**
 * DJI's FlySafe (GEO) zones round a position, from the database the DJI SDK keeps on the phone.
 * Returned as plain maps for JavaScript; flight-core decides what they mean for the flight.
 */
object FlyZones {
  fun around(lat: Double, lng: Double, done: (List<Map<String, Any?>>?, String?) -> Unit) {
    if (!DjiSdk.initialized) return done(null, "The DJI SDK is still starting. Wait a moment.")
    val main = Handler(Looper.getMainLooper())
    try {
      FlyZoneManager.getInstance().getFlyZonesInSurroundingArea(
        LocationCoordinate2D(lat, lng),
        object : CommonCallbacks.CompletionCallbackWithParam<List<FlyZoneInformation>> {
          override fun onSuccess(zones: List<FlyZoneInformation>?) {
            val out = zones.orEmpty().map(::toMap)
            main.post { done(out, null) }
          }

          override fun onFailure(error: IDJIError) {
            main.post { done(null, error.text()) }
          }
        },
      )
    } catch (e: Exception) {
      done(null, e.message ?: "FlySafe lookup failed")
    }
  }

  private fun toMap(z: FlyZoneInformation): Map<String, Any?> {
    val circle = if (z.shape == FlyZoneShape.CIRCLE && z.circleCenter != null) {
      mapOf("lat" to z.circleCenter.latitude, "lng" to z.circleCenter.longitude, "radiusM" to z.circleRadius)
    } else null
    val areas = z.multiPolygonFlyZoneInformation.orEmpty().map { a ->
      mapOf(
        "points" to a.polygonPoints.orEmpty().map { listOf(it.latitude, it.longitude) },
        "circle" to a.cylinderCenter?.let { c ->
          if (a.cylinderRadius > 0) mapOf("lat" to c.latitude, "lng" to c.longitude, "radiusM" to a.cylinderRadius) else null
        },
        "limitM" to a.limitedHeight,
      )
    }
    return mapOf(
      "id" to z.flyZoneID,
      "name" to z.name,
      "category" to z.category?.name,
      "type" to z.flyZoneType?.name,
      "lowerM" to z.lowerLimit,
      "upperM" to z.upperLimit,
      "circle" to circle,
      "areas" to areas,
    )
  }
}
