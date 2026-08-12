// @ts-nocheck ztools API 类型需逐步适配
import { refreshOnEnter } from "./composables/useProviders";
import { useQuickSwitch } from "./composables/useQuickSwitch";

export function setupDynamicCommands() {
  if (typeof ztools === "undefined" || typeof ztools.onPluginEnter !== "function") return;

  const quickSwitch = useQuickSwitch();

  // 插件加载即清理历史动态注册的供应商快捷命令（曾经通过 setFeature 注册的 switch_*）
  cleanupDynamicFeatures();

  ztools.onPluginEnter(({ code, type, payload }) => {
    // 设置插件视图高度（原 ztools pluginSetting.height）
    try { ztools.setExpendHeight(600); } catch (e) {}

    // 快速切换命令：ccs_switch_{appType}，打开插件并切到对应 Agent 页签
    if (code && code.startsWith("ccs_switch_")) {
      quickSwitch.executeSwitch(code);
      return;
    }

    // 兼容旧命令：switch_{appType}_{providerId}
    if (code && code.startsWith("switch_")) {
      const parts = code.replace("switch_", "").split("_");
      const app = parts[0];
      const id = parts.slice(1).join("_");
      const result = window.ztoolsCctoggle?.switchProvider(app, id);
      if (result?.success) {
        ztools.showNotification(`已切换到 ${result.providerName}`);
        ztools.outPlugin();
      }
      return;
    }

    // 每次进入再兜底清理一次
    cleanupDynamicFeatures();

    if (!window.ztoolsCctoggle) return;

    // 进入插件：全量重注册快速切换命令（先清后注册，幂等）
    quickSwitch.reconcile();

    // 进入插件：重新应用已激活供应商并刷新列表
    refreshOnEnter();
  });
}

function cleanupDynamicFeatures() {
  try {
    if (typeof ztools.removeFeature !== "function") return;
    let features = [];
    if (typeof ztools.getFeatures === "function") {
      features = ztools.getFeatures() || [];
    }
    let removed = 0;
    for (const f of features) {
      const code = f?.code || f;
      if (typeof code === "string" && code.startsWith("switch_")) {
        ztools.removeFeature(code);
        removed++;
      }
    }
  } catch (e) {
    console.warn("[cctoggle] cleanupDynamicFeatures failed", e);
  }
}
