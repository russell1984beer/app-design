package expo.modules.djidrone

import android.util.Log
import dji.v5.common.error.IDJIError

/** A DJI error as readable text: DJI often leaves the description empty, so add the hint and codes. */
fun IDJIError.text(): String {
  val words = listOf(description(), hint()).filter { !it.isNullOrBlank() && it != "null" }.distinct().joinToString(". ")
  val codes = listOfNotNull(errorType()?.name, errorCode(), innerCode()).filter { it.isNotBlank() && it != "null" }.joinToString(" / ")
  val out = when {
    words.isNotEmpty() && codes.isNotEmpty() -> "$words (DJI code $codes)"
    words.isNotEmpty() -> words
    codes.isNotEmpty() -> "DJI code $codes"
    else -> "no reason given by DJI"
  }
  Log.w("DjiDrone", "DJI error: $out")
  return out
}
