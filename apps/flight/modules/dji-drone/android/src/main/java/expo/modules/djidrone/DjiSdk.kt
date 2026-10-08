package expo.modules.djidrone

import android.app.Application
import android.content.Context
import dji.v5.common.error.IDJIError
import dji.v5.common.register.DJISDKInitEvent
import dji.v5.manager.SDKManager
import dji.v5.manager.interfaces.SDKManagerCallback

/**
 * Starts the DJI SDK. Called from MainApplication (the config plugin adds the calls):
 * install() from attachBaseContext, init() from onCreate.
 */
object DjiSdk {
  @Volatile var registered = false
    private set
  @Volatile var productConnected = false
    private set
  /** The SDK's native libraries are loaded and its managers can be used. Nothing may touch them before. */
  @Volatile var initialized = false
    private set
  private val waiting = mutableListOf<() -> Unit>()

  /** Run [task] once the SDK has started (straight away if it already has). */
  fun whenInitialized(task: () -> Unit) {
    val now = synchronized(waiting) {
      if (initialized) true else { waiting.add(task); false }
    }
    if (now) task()
  }

  /** Receives SDK status changes; the Expo module forwards them to JavaScript. */
  @Volatile var onStatus: ((kind: String, message: String) -> Unit)? = null
  private var lastStatus: Pair<String, String>? = null

  @JvmStatic
  fun install(app: Application) {
    com.cySdkyc.clx.Helper.install(app)
  }

  @JvmStatic
  fun init(context: Context) {
    SDKManager.getInstance().init(context, object : SDKManagerCallback {
      override fun onInitProcess(event: DJISDKInitEvent, totalProcess: Int) {
        if (event != DJISDKInitEvent.INITIALIZE_COMPLETE) return
        val ready = synchronized(waiting) {
          initialized = true
          waiting.toList().also { waiting.clear() }
        }
        report("initialized", "DJI SDK started. Registering the app…")
        ready.forEach { it() }
        SDKManager.getInstance().registerApp()
      }

      override fun onRegisterSuccess() {
        registered = true
        report("registered", "DJI SDK registered.")
      }

      override fun onRegisterFailure(error: IDJIError) {
        report("registerFailed", "DJI SDK registration failed: ${error.description()}. Check the App Key and internet connection.")
      }

      override fun onProductConnect(productId: Int) {
        productConnected = true
        report("productConnected", "Drone connected.")
      }

      override fun onProductDisconnect(productId: Int) {
        productConnected = false
        report("productDisconnected", "Drone disconnected.")
      }

      override fun onProductChanged(productId: Int) {}

      override fun onDatabaseDownloadProgress(current: Long, total: Long) {}
    })
  }

  /** The last status, so a screen that opens late still sees it. */
  fun lastStatus(): Pair<String, String>? = lastStatus

  private fun report(kind: String, message: String) {
    lastStatus = kind to message
    onStatus?.invoke(kind, message)
  }
}
