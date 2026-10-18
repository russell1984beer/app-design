package expo.modules.djidrone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * A PDF's first page as a picture, for plot drawings: the Land Registry sends title plans as PDFs.
 * Uses Android's own PDF renderer, so nothing extra is needed.
 */
object PdfPages {
  /**
   * Renders page 1 of the PDF at `uri` to a PNG at `outUri`, longest side `maxSide` px. Returns
   * [width, height] in pixels and the page's paper size [width, height] in points (1/72 inch), from
   * which a plan's printed scale gives its real size.
   */
  fun renderFirstPage(context: Context, uri: String, outUri: String, maxSide: Int): List<Int> {
    val source = Uri.parse(uri)
    val pfd = if (source.scheme == "content") {
      context.contentResolver.openFileDescriptor(source, "r") ?: throw IllegalArgumentException("Could not open the PDF.")
    } else {
      ParcelFileDescriptor.open(File(source.path ?: uri), ParcelFileDescriptor.MODE_READ_ONLY)
    }
    try {
      val renderer = PdfRenderer(pfd)
      try {
        if (renderer.pageCount == 0) throw IllegalArgumentException("The PDF has no pages.")
        val page = renderer.openPage(0)
        try {
          val scale = maxSide / max(page.width, page.height).toFloat()
          val w = (page.width * scale).roundToInt()
          val h = (page.height * scale).roundToInt()
          val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          // PDF pages are see-through; title plans are drawn on white.
          bitmap.eraseColor(Color.WHITE)
          page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          FileOutputStream(File(Uri.parse(outUri).path ?: outUri)).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
          bitmap.recycle()
          return listOf(w, h, page.width, page.height)
        } finally {
          page.close()
        }
      } finally {
        renderer.close()
      }
    } finally {
      pfd.close()
    }
  }
}
