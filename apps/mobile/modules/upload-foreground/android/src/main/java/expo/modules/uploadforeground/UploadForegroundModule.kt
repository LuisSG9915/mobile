package expo.modules.uploadforeground

import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

class UploadForegroundModule : Module() {
  private var started = false

  override fun definition() = ModuleDefinition {
    Name("UploadForeground")

    Events("onForegroundAction", "onTimeout")

    OnCreate {
      UploadForegroundService.onServiceEvent = { action ->
        sendEvent("onForegroundAction", mapOf("action" to action))
        if (action == "timeout_reached") {
          started = false
          sendEvent("onTimeout", emptyMap<String, Any>())
        }
        if (action == "pause_requested") {
          started = false
        }
      }
    }

    OnDestroy {
      UploadForegroundService.onServiceEvent = null
    }

    AsyncFunction("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(context, UploadForegroundService::class.java).apply {
        action = UploadForegroundService.ACTION_START
        putExtra(UploadForegroundService.EXTRA_TITLE, title)
        putExtra(UploadForegroundService.EXTRA_BODY, body)
      }
      started = true
      runCatching {
        ContextCompat.startForegroundService(context, intent)
        true
      }.getOrDefault(false).also { if (!it) started = false }
    }

    AsyncFunction("update") { title: String, body: String, progress: Int?, total: Int? ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(context, UploadForegroundService::class.java).apply {
        action = UploadForegroundService.ACTION_UPDATE
        putExtra(UploadForegroundService.EXTRA_TITLE, title)
        putExtra(UploadForegroundService.EXTRA_BODY, body)
        putExtra(UploadForegroundService.EXTRA_PROGRESS, progress ?: -1)
        putExtra(UploadForegroundService.EXTRA_TOTAL, total ?: -1)
      }
      runCatching {
        context.startService(intent)
        true
      }.getOrDefault(false)
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      started = false
      val intent = Intent(context, UploadForegroundService::class.java).apply {
        action = UploadForegroundService.ACTION_STOP
      }
      runCatching {
        context.stopService(intent)
        true
      }.getOrDefault(false)
    }

    AsyncFunction("isRunning") {
      started
    }

    // Fija la fecha de captura en MediaStore de un asset creado por esta app (restauración).
    // `assetId` es el id numérico de MediaStore (Asset.id de expo-media-library en Android).
    AsyncFunction("setDateTaken") { assetId: String, mediaType: String, takenAtMs: Double ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("React context no disponible")
      val base = if (mediaType == "video") {
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      }
      val uri = ContentUris.withAppendedId(base, assetId.toLong())
      val millis = takenAtMs.toLong()
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DATE_TAKEN, millis)
        put(MediaStore.MediaColumns.DATE_MODIFIED, millis / 1000)
      }
      context.contentResolver.update(uri, values, null, null) > 0
    }

    AsyncFunction("sha256File") { fileUri: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("React context no disponible")

      val inputStream: InputStream = when {
        fileUri.startsWith("content://") -> {
          context.contentResolver.openInputStream(Uri.parse(fileUri))
            ?: throw IllegalArgumentException("No se pudo abrir content URI: $fileUri")
        }
        else -> {
          val cleanPath = fileUri.removePrefix("file://")
          FileInputStream(File(cleanPath))
        }
      }

      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(64 * 1024)

      BufferedInputStream(inputStream, buffer.size).use { bis ->
        var bytesRead = bis.read(buffer)
        while (bytesRead != -1) {
          digest.update(buffer, 0, bytesRead)
          bytesRead = bis.read(buffer)
        }
      }

      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}