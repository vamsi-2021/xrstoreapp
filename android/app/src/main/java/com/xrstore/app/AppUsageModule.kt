package com.xrstore.app

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*

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
