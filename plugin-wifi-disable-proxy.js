/**
 * WIFI 禁用代理
 * 监测当前连接的 WIFI 名称，当切换到用户配置的 WIFI 时自动停止代理
 *
 * 客户端没有提供 WIFI 切换触发器，因此通过定时读取系统命令获取当前 SSID
 */

/**
 * 读取并规范化插件配置
 * @param {Object} source 配置来源，Plugin 实例或 onConfigure 传入的配置
 * @returns {{wifiList: string[], interval: number, stopAction: string, matchMode: string, notify: boolean}} 规范化后的配置
 */
function readSettings(source) {
  const data = source || {}
  const raw = data.WifiList || []
  const wifiList = (Array.isArray(raw) ? raw : String(raw).split(/[\n,，]/))
    .map((value) => String(value).trim())
    .filter(Boolean)
  return {
    wifiList,
    interval: Math.max(3, Number(data.CheckInterval) || 5),
    stopAction: ['both', 'kernel', 'system'].includes(data.StopAction) ? data.StopAction : 'both',
    matchMode: data.MatchMode === 'leave' ? 'leave' : 'connect',
    notify: data.Notify !== false
  }
}

/**
 * 读取当前连接的 WIFI 名称
 * @returns {Promise<string>} 当前 SSID，获取失败时返回空字符串
 */
async function getCurrentSSID() {
  const env = Plugins.useEnvStore().env || {}
  try {
    if (env.os === 'windows') {
      const output = await Plugins.Exec('netsh', ['wlan', 'show', 'interfaces'])
      // 多网卡时取第一个非空的 SSID
      for (const match of String(output).matchAll(/^\s*SSID\s*:\s*(.*)$/gm)) {
        const ssid = match[1].trim()
        if (ssid) return ssid
      }
      return ''
    }
    if (env.os === 'darwin') {
      try {
        const airport = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
        const output = await Plugins.Exec(airport, ['-I'])
        const match = String(output).match(/^\s*SSID:\s*(.+)$/m)
        if (match && match[1].trim()) return match[1].trim()
      } catch (error) {
        // airport 命令在新版 macOS 可能不存在，继续尝试 networksetup
      }
      for (const device of ['en0', 'en1', 'en2']) {
        try {
          const output = await Plugins.Exec('networksetup', ['-getairportnetwork', device])
          const match = String(output).match(/Network:\s*(.+)/)
          if (match && match[1].trim()) return match[1].trim()
        } catch (error) {
          // 当前设备不是无线网卡，继续下一个
        }
      }
      return ''
    }
    try {
      const output = await Plugins.Exec('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi'])
      const line = String(output).split('\n').find((item) => item.startsWith('yes:'))
      if (line) return line.slice(4).trim()
    } catch (error) {
      // 没有 nmcli 时回退到 iwgetid
    }
    return String(await Plugins.Exec('iwgetid', ['-r'])).trim()
  } catch (error) {
    return ''
  }
}

/** @type {EsmPlugin} */
export default (Plugin) => {
  const ui_id = Plugin.id + '_ui'
  const appStore = Plugins.useAppStore()

  // 监测定时器
  let timer = null
  // 上一次读取到的 SSID，首次读取只记录基线
  let lastSSID = null
  // 当前生效的配置
  let settings = readSettings(Plugin)

  /**
   * 更新核心状态区的开关
   * @param {boolean} value 开关状态
   * @returns {void}
   */
  const updateWidget = (value) => {
    appStore.removeCustomActions('core_state', [ui_id])
    appStore.addCustomActions('core_state', {
      id: ui_id,
      component: 'Switch',
      componentSlots: {
        default: 'WIFI禁用代理'
      },
      componentProps: {
        size: 'small',
        border: 'square',
        modelValue: value,
        onChange: async (val) => {
          val ? start() : stop()
        }
      }
    })
  }

  /**
   * 移除核心状态区的开关
   * @returns {void}
   */
  const del_ui = () => {
    appStore.removeCustomActions('core_state', [ui_id])
  }

  /**
   * 停止代理
   * @returns {Promise<void>}
   */
  const stopProxy = async () => {
    const envStore = Plugins.useEnvStore()
    const kernelApiStore = Plugins.useKernelApiStore()
    if (settings.stopAction !== 'kernel') {
      await envStore.clearSystemProxy()
    }
    if (settings.stopAction !== 'system' && kernelApiStore.running) {
      await kernelApiStore.stopKernel()
    }
  }

  /**
   * 检测当前 SSID 并处理切换
   * @returns {Promise<void>}
   */
  const checkSSID = async () => {
    const ssid = await getCurrentSSID()
    // 读不到 SSID 时不做判断，避免误触发
    if (!ssid || ssid === lastSSID) return
    const isFirst = lastSSID === null
    lastSSID = ssid
    if (isFirst) return
    const matched = settings.wifiList.includes(ssid)
    const shouldStop = settings.matchMode === 'connect' ? matched : !matched
    if (!shouldStop) return
    console.log(`[${Plugin.name}]`, `WIFI 已切换到 ${ssid}，停止代理`)
    try {
      await stopProxy()
      if (settings.notify) {
        Plugins.message.info(`[${Plugin.name}] 已切换到 ${ssid}，代理已停止`, 4000)
      }
    } catch (error) {
      Plugins.message.error(`[${Plugin.name}] 停止代理失败：${error?.message || error}`)
    }
  }

  /**
   * 启动监测
   * @returns {number} 状态码，1 表示运行中
   */
  const start = () => {
    if (timer) return 1
    if (!settings.wifiList.length) {
      Plugins.message.info(`[${Plugin.name}] 请先在插件配置中添加 WIFI 名称`, 5000)
      return 0
    }
    lastSSID = null
    timer = Plugins.setIntervalImmediately(checkSSID, settings.interval * 1000)
    Plugin.status = 1
    updateWidget(true)
    console.log(`[${Plugin.name}]`, '监测已启动')
    return 1
  }

  /**
   * 停止监测
   * @returns {number} 状态码，2 表示已停止
   */
  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    lastSSID = null
    Plugin.status = 2
    updateWidget(false)
    console.log(`[${Plugin.name}]`, '监测已停止')
    return 2
  }

  /**
   * 按新配置重启监测
   * @returns {void}
   */
  const restart = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
    lastSSID = null
    timer = Plugins.setIntervalImmediately(checkSSID, settings.interval * 1000)
    updateWidget(true)
  }

  const onRun = async () => start()

  const onReady = async () => {
    if (!settings.wifiList.length) {
      updateWidget(false)
      return
    }
    if (Plugin.status === 1) {
      setTimeout(start, 3000)
    }
    updateWidget(Plugin.status === 1)
  }

  const onConfigure = async (config, old) => {
    settings = readSettings(config)
    if (timer && Number(config?.CheckInterval) !== Number(old?.CheckInterval)) {
      restart()
    }
  }

  const onDispose = () => {
    if (timer) clearInterval(timer)
    timer = null
    del_ui()
  }

  return {
    onRun,
    onReady,
    Start: async () => start(),
    Stop: async () => stop(),
    onConfigure,
    onDispose
  }
}
