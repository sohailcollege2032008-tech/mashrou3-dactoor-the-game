package com.mashrou3dactoor.med_royale_mobile

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val METHOD_CHANNEL = "com.mashrou3dactoor.med_royale/security_methods"
    private val EVENT_CHANNEL = "com.mashrou3dactoor.med_royale/security_events"
    private var eventSink: EventChannel.EventSink? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Enforce FLAG_SECURE to block screen capture, screenshots, and screen sharing
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "enableSecureFlag" -> {
                    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
                    result.success(true)
                }
                "disableSecureFlag" -> {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    result.success(true)
                }
                "isMultiWindow" -> {
                    val inMulti = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        isInMultiWindowMode
                    } else {
                        false
                    }
                    result.success(inMulti)
                }
                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    eventSink = events
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            }
        )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Notify Flutter layer about focus change (lost focus indicates overlay or backgrounding)
        eventSink?.success(mapOf("type" to "focus_change", "hasFocus" to hasFocus))
    }

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration?) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        eventSink?.success(mapOf("type" to "multi_window_change", "isMultiWindow" to isInMultiWindowMode))
    }
}
