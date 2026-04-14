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
     * Downloads the ZIP from zipUrl, extracts the APK matching fileName, and triggers installation.
     */
    @ReactMethod
    fun installApp(zipUrl: String, fileName: String, promise: Promise) {
        Thread {
            try {
                android.util.Log.d("XRInstall", "installApp called: zipUrl=$zipUrl fileName=$fileName")

                val cacheDir = File(reactApplicationContext.cacheDir, "apk_installs")
                cacheDir.mkdirs()
                android.util.Log.d("XRInstall", "Cache dir: ${cacheDir.absolutePath}")

                val zipFile = File(cacheDir, "temp.zip")
                val apkFile = File(cacheDir, fileName.removeSuffix(".zip") + ".apk")
                android.util.Log.d("XRInstall", "APK target path: ${apkFile.absolutePath}")

                // Download the ZIP
                android.util.Log.d("XRInstall", "Starting download...")
                val connection = URL(zipUrl).openConnection() as HttpURLConnection
                connection.connectTimeout = 30_000
                connection.readTimeout = 120_000
                connection.connect()
                android.util.Log.d("XRInstall", "HTTP response code: ${connection.responseCode}")
                FileOutputStream(zipFile).use { out ->
                    connection.inputStream.use { it.copyTo(out) }
                }
                connection.disconnect()
                android.util.Log.d("XRInstall", "Download complete. ZIP size: ${zipFile.length()} bytes")

                // Extract APK from ZIP
                android.util.Log.d("XRInstall", "Extracting APK from ZIP...")
                var extracted = false
                ZipInputStream(FileInputStream(zipFile)).use { zip ->
                    var entry = zip.nextEntry
                    while (entry != null) {
                        android.util.Log.d("XRInstall", "ZIP entry: ${entry.name}")
                        if (!entry.isDirectory && entry.name.endsWith(".apk")) {
                            android.util.Log.d("XRInstall", "Found APK entry: ${entry.name}")
                            FileOutputStream(apkFile).use { out -> zip.copyTo(out) }
                            extracted = true
                            break
                        }
                        entry = zip.nextEntry
                    }
                }
                zipFile.delete()
                android.util.Log.d("XRInstall", "Extraction done. extracted=$extracted APK size: ${apkFile.length()} bytes")

                if (!extracted) {
                    android.util.Log.e("XRInstall", "APK not found in ZIP")
                    promise.reject("INSTALL_ERROR", "APK not found in ZIP")
                    return@Thread
                }

                // Read package name from APK
                val pkgInfo = reactApplicationContext.packageManager
                    .getPackageArchiveInfo(apkFile.absolutePath, 0)
                val extractedPackageName = pkgInfo?.packageName ?: ""
                android.util.Log.d("XRInstall", "Package name from APK: $extractedPackageName")

                // Trigger system installer
                val uri = FileProvider.getUriForFile(
                    reactApplicationContext,
                    "${reactApplicationContext.packageName}.provider",
                    apkFile
                )
                android.util.Log.d("XRInstall", "FileProvider URI: $uri")
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(intent)
                android.util.Log.d("XRInstall", "Install intent launched successfully")
                promise.resolve(extractedPackageName)
            } catch (e: Exception) {
                android.util.Log.e("XRInstall", "installApp error: ${e.message}", e)
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
