package expo.modules.uploadforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class UploadForegroundService : Service() {

  companion object {
    const val CHANNEL_ID = "cloud_photos_upload_channel"
    const val NOTIFICATION_ID = 4201

    const val ACTION_START = "expo.modules.uploadforeground.ACTION_START"
    const val ACTION_UPDATE = "expo.modules.uploadforeground.ACTION_UPDATE"
    const val ACTION_STOP = "expo.modules.uploadforeground.ACTION_STOP"
    const val ACTION_PAUSE_CLICKED = "expo.modules.uploadforeground.ACTION_PAUSE_CLICKED"

    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_PROGRESS = "progress"
    const val EXTRA_TOTAL = "total"

    private const val MIN_UPDATE_INTERVAL_MS = 250L
    private const val WAKELOCK_TIMEOUT_MS = 20 * 60 * 1000L // 20 min renovables

    var onServiceEvent: ((event: String) -> Unit)? = null
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var lastUpdateRealtimeMs: Long = 0L
  private var isStartedInForeground = false

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PAUSE_CLICKED -> {
        onServiceEvent?.invoke("pause_requested")
        stopForegroundCleanly()
        return START_NOT_STICKY
      }
      ACTION_STOP -> {
        stopForegroundCleanly()
        return START_NOT_STICKY
      }
      ACTION_START, ACTION_UPDATE -> {
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Sincronizando fotos"
        val body = intent.getStringExtra(EXTRA_BODY) ?: "Subiendo elementos a la nube…"
        val progress = intent.getIntExtra(EXTRA_PROGRESS, -1)
        val total = intent.getIntExtra(EXTRA_TOTAL, -1)

        val now = SystemClock.elapsedRealtime()
        val isCompletion = total in 1..progress
        if (intent.action == ACTION_UPDATE && !isCompletion && (now - lastUpdateRealtimeMs) < MIN_UPDATE_INTERVAL_MS) {
          return START_NOT_STICKY
        }
        lastUpdateRealtimeMs = now

        acquireLocks()
        val notification = buildNotification(title, body, progress, total)

        if (!isStartedInForeground) {
          val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
          } else {
            0
          }
          ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fgsType)
          isStartedInForeground = true
        } else {
          val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          nm.notify(NOTIFICATION_ID, notification)
        }
      }
    }
    return START_NOT_STICKY
  }

  // Requerido en Android 15 (API 35) para evitar crash al alcanzar el límite de tiempo de dataSync
  override fun onTimeout(startId: Int, fgsType: Int) {
    onServiceEvent?.invoke("timeout_reached")
    stopForegroundCleanly()
  }

  private fun stopForegroundCleanly() {
    releaseLocks()
    isStartedInForeground = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun acquireLocks() {
    if (wakeLock?.isHeld != true) {
      val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CloudPhotos:UploadWakeLock").apply {
        setReferenceCounted(false)
        acquire(WAKELOCK_TIMEOUT_MS)
      }
    } else {
      // Renovar timeout mientras haya progreso activo
      wakeLock?.acquire(WAKELOCK_TIMEOUT_MS)
    }

    if (wifiLock?.isHeld != true) {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val lockMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        WifiManager.WIFI_MODE_FULL_LOW_LATENCY
      } else {
        @Suppress("DEPRECATION")
        WifiManager.WIFI_MODE_FULL_HIGH_PERF
      }
      wifiLock = wm.createWifiLock(lockMode, "CloudPhotos:UploadWifiLock").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun releaseLocks() {
    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
    wakeLock = null
    wifiLock = null
  }

  private fun buildNotification(title: String, body: String, progress: Int, total: Int): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentPendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val pauseIntent = Intent(this, UploadForegroundService::class.java).apply {
      action = ACTION_PAUSE_CLICKED
    }
    val pausePendingIntent = PendingIntent.getService(
      this,
      1,
      pauseIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(contentPendingIntent)
      .addAction(android.R.drawable.ic_media_pause, "Pausar", pausePendingIntent)

    if (total > 0 && progress >= 0) {
      builder.setProgress(total, progress.coerceAtMost(total), false)
    } else {
      builder.setProgress(0, 0, true)
    }

    return builder.build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Respaldo en segundo plano",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Muestra el progreso de subida de tus fotos y videos"
        setShowBadge(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }

  override fun onDestroy() {
    releaseLocks()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}