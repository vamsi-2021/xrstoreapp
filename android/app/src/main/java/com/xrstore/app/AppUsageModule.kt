package com.xrstore.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

class AppUsageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppUsageModule"

    private fun hasUsagePermission(): Boolean {
        val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                reactApplicationContext.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                reactApplicationContext.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    @ReactMethod
    fun openUsageSettings() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun getAppUsage(packageName: String, promise: Promise) {
        if (!hasUsagePermission()) {
            promise.reject("PERMISSION_DENIED", "Usage access permission not granted. Call openUsageSettings() to prompt the user.")
            return
        }

        val usageManager = reactApplicationContext
            .getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val endTime = System.currentTimeMillis()
        val startTime = endTime - 30L * 24 * 60 * 60 * 1000 // last 30 days

        val stats = usageManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startTime,
            endTime
        )

        val appStats = stats?.filter { it.packageName == packageName }

        if (appStats.isNullOrEmpty()) {
            val result = Arguments.createMap().apply {
                putString("packageName", packageName)
                putDouble("totalTimeInForeground", 0.0)
                putString("totalTimeFormatted", "00:00")
                putInt("launchCount", 0)
            }
            promise.resolve(result)
            return
        }

        val totalMs = appStats.sumOf { it.totalTimeInForeground }
        val hours = (totalMs / 1000 / 3600).toInt()
        val minutes = ((totalMs / 1000 % 3600) / 60).toInt()
        val formatted = String.format("%02d:%02d", hours, minutes)

        val result = Arguments.createMap().apply {
            putString("packageName", packageName)
            putDouble("totalTimeInForeground", totalMs.toDouble())
            putString("totalTimeFormatted", formatted)
        }
        promise.resolve(result)
    }

    /**
     * Returns the installed version name for the given package, or null if not installed.
     */
    @ReactMethod
    fun getInstalledVersion(packageName: String, promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, 0)
            }
            promise.resolve(info.versionName)
        } catch (e: PackageManager.NameNotFoundException) {
            promise.resolve(null)
        }
    }

    /**
     * Launches the app with the given package name.
     */
    @ReactMethod
    fun launchApp(packageName: String, promise: Promise) {
        val intent = reactApplicationContext.packageManager.getLaunchIntentForPackage(packageName)
        if (intent == null) {
            promise.reject("NOT_FOUND", "No launch intent found for $packageName")
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
        promise.resolve(true)
    }

    /**
     * Downloads a ZIP from zipUrl, extracts the first APK inside, and triggers the system install dialog.
     * Emits "downloadProgress" events with { progress: 0-100 } during download.
     */
    @ReactMethod
    fun downloadAndInstall(zipUrl: String, fileName: String, promise: Promise) {
        Thread {
            val cacheDir = reactApplicationContext.cacheDir
            val zipFile = File(cacheDir, "$fileName.zip")
            val apkFile = File(cacheDir, "$fileName.apk")
            android.util.Log.d("AppUsageModule", "[Install] downloadAndInstall called: fileName=$fileName")
            android.util.Log.d("AppUsageModule", "[Install] zipFile path: ${zipFile.absolutePath}")
            android.util.Log.d("AppUsageModule", "[Install] apkFile path: ${apkFile.absolutePath}")
            try {
                // Download ZIP
                android.util.Log.d("AppUsageModule", "[Install] Connecting to URL: $zipUrl")
                val connection = URL(zipUrl).openConnection() as HttpURLConnection
                connection.connect()
                val statusCode = connection.responseCode
                android.util.Log.d("AppUsageModule", "[Install] HTTP status: $statusCode")
                if (statusCode !in 200..299) {
                    promise.reject("DOWNLOAD_ERROR", "Server returned HTTP $statusCode")
                    return@Thread
                }
                val totalBytes = connection.contentLength.toLong()
                android.util.Log.d("AppUsageModule", "[Install] Total bytes to download: $totalBytes")
                BufferedInputStream(connection.inputStream).use { input ->
                    FileOutputStream(zipFile).use { output ->
                        val buffer = ByteArray(8192)
                        var downloaded = 0L
                        var lastReported = -1
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloaded += bytesRead
                            if (totalBytes > 0) {
                                val progress = (downloaded * 100 / totalBytes).toInt()
                                if (progress != lastReported) {
                                    lastReported = progress
                                    val params = Arguments.createMap()
                                    params.putInt("progress", progress)
                                    reactApplicationContext
                                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                                        .emit("downloadProgress", params)
                                }
                            }
                        }
                    }
                }

                android.util.Log.d("AppUsageModule", "[Install] Download complete, zip size: ${zipFile.length()} bytes")

                // Unzip — extract first .apk entry (case-insensitive)
                android.util.Log.d("AppUsageModule", "[Install] Starting unzip...")
                var found = false
                val entryNames = mutableListOf<String>()
                ZipInputStream(FileInputStream(zipFile)).use { zis ->
                    var entry = zis.nextEntry
                    while (entry != null) {
                        entryNames.add(entry.name)
                        android.util.Log.d("AppUsageModule", "[Install] ZIP entry: ${entry.name} (dir=${entry.isDirectory})")
                        if (!entry.isDirectory && entry.name.lowercase().endsWith(".apk")) {
                            android.util.Log.d("AppUsageModule", "[Install] Found APK entry: ${entry.name}, extracting...")
                            FileOutputStream(apkFile).use { fos -> zis.copyTo(fos) }
                            found = true
                            break
                        }
                        entry = zis.nextEntry
                    }
                }
                zipFile.delete()
                android.util.Log.d("AppUsageModule", "[Install] All ZIP entries: ${entryNames.joinToString(", ")}")

                if (!found) {
                    android.util.Log.e("AppUsageModule", "[Install] FAILED — no APK in ZIP. Entries: ${entryNames.joinToString(", ")}")
                    promise.reject("UNZIP_ERROR", "No APK found. ZIP entries: ${entryNames.joinToString(", ")}")
                    return@Thread
                }

                android.util.Log.d("AppUsageModule", "[Install] APK extracted to: ${apkFile.absolutePath} (${apkFile.length()} bytes)")

                // Trigger install dialog
                val apkUri = FileProvider.getUriForFile(
                    reactApplicationContext,
                    "${reactApplicationContext.packageName}.fileprovider",
                    apkFile
                )
                android.util.Log.d("AppUsageModule", "[Install] Launching install dialog for URI: $apkUri")
                val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                reactApplicationContext.startActivity(intent)
                android.util.Log.d("AppUsageModule", "[Install] Install dialog launched successfully")
                promise.resolve(apkFile.absolutePath)
            } catch (e: Exception) {
                android.util.Log.e("AppUsageModule", "[Install] Exception: ${e.javaClass.simpleName}: ${e.message}", e)
                zipFile.delete()
                promise.reject("INSTALL_ERROR", e.message ?: "Unknown error")
            }
        }.start()
    }

    /**
     * Opens the system uninstall dialog for the given package name.
     */
    @ReactMethod
    fun uninstallApp(packageName: String, promise: Promise) {
        val intent = Intent(Intent.ACTION_DELETE).apply {
            data = android.net.Uri.parse("package:$packageName")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
        promise.resolve(true)
    }
}
