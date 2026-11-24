package expo.modules.videothumbnail

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class VideoThumbnailModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoThumbnail")

    AsyncFunction("generate") { videoUri: String, options: Map<String, Any?>? ->
      generateThumbnail(videoUri, options)
    }

    AsyncFunction("getThumbnail") { uri: String, maxSize: Int? ->
      val result = generateThumbnail(uri, mapOf("maxWidth" to (maxSize ?: 400), "maxHeight" to (maxSize ?: 400)))
      (result["uri"] as? String)?.removePrefix("file://") ?: ""
    }

    AsyncFunction("applyColorMatrix") { sourceUri: String, matrixValues: List<Double>, quality: Int? ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("React context no disponible")

      if (matrixValues.size != 20) {
        throw IllegalArgumentException("Se esperaban 20 valores para ColorMatrix")
      }

      val cleanPath = sourceUri.removePrefix("file://")
      val srcBitmap = BitmapFactory.decodeFile(cleanPath)
        ?: throw IllegalStateException("No se pudo decodificar imagen: $sourceUri")

      val outBitmap = Bitmap.createBitmap(srcBitmap.width, srcBitmap.height, Bitmap.Config.ARGB_8888)

      try {
        val floatArray = FloatArray(20) { idx -> matrixValues[idx].toFloat() }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
          colorFilter = ColorMatrixColorFilter(ColorMatrix(floatArray))
        }
        val canvas = Canvas(outBitmap)
        canvas.drawBitmap(srcBitmap, 0f, 0f, paint)

        val outDir = File(context.cacheDir, "edited-photos").apply { mkdirs() }
        val useWebp = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val ext = if (useWebp) "webp" else "jpg"
        val outFile = File(outDir, "edit_${UUID.randomUUID()}.$ext")
        val safeQuality = (quality ?: 92).coerceIn(10, 100)

        FileOutputStream(outFile).use { fos ->
          val fmt = if (useWebp) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.JPEG
          outBitmap.compress(fmt, safeQuality, fos)
        }

        mapOf("uri" to "file://${outFile.absolutePath}", "width" to outBitmap.width, "height" to outBitmap.height)
      } finally {
        srcBitmap.recycle()
        outBitmap.recycle()
      }
    }
  }

  private fun generateThumbnail(videoUri: String, options: Map<String, Any?>?): Map<String, Any> {
    val context = appContext.reactContext
      ?: throw IllegalStateException("React context no disponible")

    val maxWidth = (options?.get("maxWidth") as? Number)?.toInt() ?: 512
    val maxHeight = (options?.get("maxHeight") as? Number)?.toInt() ?: 512
    val quality = ((options?.get("quality") as? Number)?.toInt() ?: 80).coerceIn(10, 100)
    val requestedTimeMs = (options?.get("timeMs") as? Number)?.toLong()

    val retriever = MediaMetadataRetriever()
    return try {
      if (videoUri.startsWith("content://")) {
        retriever.setDataSource(context, Uri.parse(videoUri))
      } else {
        val cleanPath = videoUri.removePrefix("file://")
        retriever.setDataSource(cleanPath)
      }

      val durationMs = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull() ?: 0L

      val srcWidth = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
        ?.toIntOrNull() ?: maxWidth
      val srcHeight = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
        ?.toIntOrNull() ?: maxHeight
      val rotation = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
        ?.toIntOrNull() ?: 0

      // Evita el primer frame negro eligiendo 1s o el 10% de la duración
      val targetTimeMs = requestedTimeMs ?: if (durationMs > 0) {
        minOf(1000L, durationMs / 10)
      } else {
        0L
      }
      val timeUs = targetTimeMs * 1000L

      // Escala proporcional sin decodificar 4K completo en memoria
      val scale = minOf(
        maxWidth.toFloat() / maxOf(srcWidth, 1),
        maxHeight.toFloat() / maxOf(srcHeight, 1),
        1.0f
      )
      val outWidth = maxOf(1, (srcWidth * scale).toInt())
      val outHeight = maxOf(1, (srcHeight * scale).toInt())

      val bitmap: Bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        retriever.getScaledFrameAtTime(
          timeUs,
          MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
          outWidth,
          outHeight
        ) ?: retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      } else {
        retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      } ?: throw IllegalStateException("No se pudo extraer frame de $videoUri")

      try {
        val thumbsDir = File(context.cacheDir, "video-thumbnails").apply { mkdirs() }
        val useWebp = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        val ext = if (useWebp) "webp" else "jpg"
        val outFile = File(thumbsDir, "vthumb_${UUID.randomUUID()}.$ext")

        FileOutputStream(outFile).use { fos ->
          val format = if (useWebp) {
            Bitmap.CompressFormat.WEBP_LOSSY
          } else {
            Bitmap.CompressFormat.JPEG
          }
          bitmap.compress(format, quality, fos)
        }

        mapOf(
          "uri" to "file://${outFile.absolutePath}",
          "width" to bitmap.width,
          "height" to bitmap.height,
          "durationMs" to durationMs,
          "rotation" to rotation
        )
      } finally {
        bitmap.recycle()
      }
    } finally {
      runCatching { retriever.release() }
    }
  }
}