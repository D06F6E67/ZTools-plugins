import { useEffect, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AiGradientIcon } from "@/components/ui/ai-gradient-icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  fetchCustomAIModels,
  getStoredAIModelOptions,
  type AIModelOption,
  type CustomAIProtocol,
} from "@/lib/ai-provider";
import type { AISettings } from "@/stores/useSettings";
import { SettingsSectionCard } from "./settings/SettingsSectionCard";
import { cn } from "@/lib/utils";

interface SettingsAIProps {
  ai: AISettings;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  selectedModelId: string | null;
  setSelectedModelId: (modelId: string | null) => void;
  saveCustomConfig: (config: {
    protocol: CustomAIProtocol;
    baseURL: string;
    apiKey: string;
    modelOptions: AIModelOption[];
  }) => void;
}

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const CUSTOM_PROTOCOL_OPTIONS: Array<{
  id: CustomAIProtocol;
  label: string;
  description: string;
}> = [
  {
    id: "openai-responses",
    label: "OpenAI 官方 Responses API",
    description: "使用 /v1/responses，适合 OpenAI 及支持 Responses 的服务",
  },
  {
    id: "openai",
    label: "OpenAI 兼容协议",
    description: "使用 /v1/chat/completions，兼容多数模型与中转服务",
  },
  {
    id: "claude",
    label: "Anthropic 原生工具调用",
    description: "通过 Messages API 使用 Anthropic 原生工具能力",
  },
];

const CUSTOM_AI_KEY_HINT = "请前往“设置 -> AI 助手 -> AI 服务”补充 API Key";

interface CustomAIConnection {
  protocol: CustomAIProtocol;
  baseURL: string;
  apiKey: string;
}

function getSupportedProtocol(protocol: CustomAIProtocol): CustomAIProtocol {
  return CUSTOM_PROTOCOL_OPTIONS.some((option) => option.id === protocol)
    ? protocol
    : "openai-responses";
}

export function SettingsAI({
  ai,
  enabled,
  setEnabled,
  selectedModelId,
  setSelectedModelId,
  saveCustomConfig,
}: SettingsAIProps) {
  const [customProtocol, setCustomProtocol] = useState<CustomAIProtocol>(
    getSupportedProtocol(ai.customProtocol),
  );
  const [customOpenAIResponsesBaseURL, setCustomOpenAIResponsesBaseURL] =
    useState(ai.customOpenAIResponsesBaseURL || DEFAULT_OPENAI_BASE_URL);
  const [customOpenAIBaseURL, setCustomOpenAIBaseURL] = useState(
    ai.customOpenAIBaseURL || DEFAULT_OPENAI_BASE_URL,
  );
  const [customClaudeBaseURL, setCustomClaudeBaseURL] = useState(
    ai.customClaudeBaseURL || DEFAULT_CLAUDE_BASE_URL,
  );
  const [customOpenAIResponsesApiKey, setCustomOpenAIResponsesApiKey] =
    useState(ai.customOpenAIResponsesApiKey);
  const [customOpenAIApiKey, setCustomOpenAIApiKey] = useState(
    ai.customOpenAIApiKey,
  );
  const [customClaudeApiKey, setCustomClaudeApiKey] = useState(
    ai.customClaudeApiKey,
  );
  const [savingCustomConfig, setSavingCustomConfig] = useState(false);
  const [customSaveError, setCustomSaveError] = useState<string | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const modelSectionRef = useRef<HTMLDivElement | null>(null);
  const modelRequestIdRef = useRef(0);

  const storedCustomModels = getStoredAIModelOptions(ai);
  // 切换到尚未保存的新供应商时，不继续展示上一个供应商的旧模型列表。
  const customModels =
    customProtocol === ai.customProtocol ? storedCustomModels : [];

  useEffect(() => {
    setCustomProtocol(getSupportedProtocol(ai.customProtocol));
  }, [ai.customProtocol]);

  useEffect(() => {
    setCustomOpenAIResponsesBaseURL(
      ai.customOpenAIResponsesBaseURL || DEFAULT_OPENAI_BASE_URL,
    );
  }, [ai.customOpenAIResponsesBaseURL]);

  useEffect(() => {
    setCustomOpenAIBaseURL(
      ai.customOpenAIBaseURL || DEFAULT_OPENAI_BASE_URL,
    );
  }, [ai.customOpenAIBaseURL]);

  useEffect(() => {
    setCustomClaudeBaseURL(ai.customClaudeBaseURL || DEFAULT_CLAUDE_BASE_URL);
  }, [ai.customClaudeBaseURL]);

  useEffect(() => {
    setCustomOpenAIResponsesApiKey(ai.customOpenAIResponsesApiKey);
  }, [ai.customOpenAIResponsesApiKey]);

  useEffect(() => {
    setCustomOpenAIApiKey(ai.customOpenAIApiKey);
  }, [ai.customOpenAIApiKey]);

  useEffect(() => {
    setCustomClaudeApiKey(ai.customClaudeApiKey);
  }, [ai.customClaudeApiKey]);

  useEffect(() => {
    if (customModels.length === 0) {
      return;
    }

    if (
      !selectedModelId ||
      !customModels.some((item) => item.id === selectedModelId)
    ) {
      setSelectedModelId(customModels[0].id);
    }
  }, [customModels, selectedModelId, setSelectedModelId]);

  const currentModel =
    customModels.find((item) => item.id === selectedModelId) ?? null;
  const selectedProtocol =
    CUSTOM_PROTOCOL_OPTIONS.find((item) => item.id === customProtocol) ??
    CUSTOM_PROTOCOL_OPTIONS[0];
  const customBaseURL =
    customProtocol === "openai-responses"
      ? customOpenAIResponsesBaseURL
      : customProtocol === "openai"
        ? customOpenAIBaseURL
        : customClaudeBaseURL;
  const customApiKey =
    customProtocol === "openai-responses"
      ? customOpenAIResponsesApiKey
      : customProtocol === "openai"
        ? customOpenAIApiKey
        : customClaudeApiKey;
  const getConnectionForProtocol = (
    protocol: CustomAIProtocol,
  ): CustomAIConnection => {
    if (protocol === "openai-responses") {
      return {
        protocol,
        baseURL: customOpenAIResponsesBaseURL.trim() || DEFAULT_OPENAI_BASE_URL,
        apiKey: customOpenAIResponsesApiKey,
      };
    }
    if (protocol === "openai") {
      return {
        protocol,
        baseURL: customOpenAIBaseURL.trim() || DEFAULT_OPENAI_BASE_URL,
        apiKey: customOpenAIApiKey,
      };
    }
    return {
      protocol,
      baseURL: customClaudeBaseURL.trim() || DEFAULT_CLAUDE_BASE_URL,
      apiKey: customClaudeApiKey,
    };
  };

  const scrollToModelSection = () => {
    requestAnimationFrame(() => {
      const target = modelSectionRef.current;
      if (!target) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      target.focus({ preventScroll: true });
    });
  };

  const saveButtonReason = savingCustomConfig
    ? "正在保存并读取模型列表"
    : !customApiKey.trim()
      ? CUSTOM_AI_KEY_HINT
      : null;

  const modelButtonDisabled =
    !enabled || savingCustomConfig || customModels.length === 0;

  const modelButtonReason = !enabled
    ? "先打开 AI 助手开关后才能选择模型"
    : savingCustomConfig
      ? "模型列表读取中，请稍候"
      : customSaveError
        ? customSaveError
        : customModels.length === 0
          ? "请先填写并保存自定义 AI 配置"
          : null;

  const refreshCustomModels = async (
    connection: CustomAIConnection,
    action: "save" | "switch" | "refresh",
  ) => {
    const apiKey = connection.apiKey.trim();
    if (!apiKey) {
      toast.error(CUSTOM_AI_KEY_HINT);
      return;
    }

    const provider =
      CUSTOM_PROTOCOL_OPTIONS.find(
        (option) => option.id === connection.protocol,
      ) ?? CUSTOM_PROTOCOL_OPTIONS[0];
    const requestId = modelRequestIdRef.current + 1;
    modelRequestIdRef.current = requestId;
    setSavingCustomConfig(true);
    setCustomSaveError(null);

    // 先持久化 Base URL / API Key，避免拉模型失败时配置丢失、下次重填。
    // 同协议保留已有模型列表；切换协议时先清空，等拉取成功再写入。
    const previousModelOptions =
      connection.protocol === ai.customProtocol ? storedCustomModels : [];
    saveCustomConfig({
      protocol: connection.protocol,
      baseURL: connection.baseURL,
      apiKey,
      modelOptions: previousModelOptions,
    });

    try {
      const modelOptions = await fetchCustomAIModels({
        protocol: connection.protocol,
        baseURL: connection.baseURL,
        apiKey,
      });
      if (requestId !== modelRequestIdRef.current) return;

      saveCustomConfig({
        protocol: connection.protocol,
        baseURL: connection.baseURL,
        apiKey,
        modelOptions,
      });

      const nextModel =
        modelOptions.find((model) => model.id === selectedModelId) ??
        modelOptions[0] ??
        null;
      setSelectedModelId(nextModel?.id ?? null);
      scrollToModelSection();

      if (modelOptions.length === 0) {
        toast.warning(`${provider.label} 配置已保存`, {
          description: "已获取 0 个模型，请确认该服务是否提供模型列表接口。",
        });
      } else {
        const actionLabel =
          action === "switch"
            ? `已切换到 ${provider.label}`
            : action === "refresh"
              ? `${provider.label} 模型列表已更新`
              : `${provider.label} 配置已保存`;
        toast.success(actionLabel, {
          description: `已获取 ${modelOptions.length} 个模型，默认选择 ${nextModel?.label ?? nextModel?.id}。`,
        });
      }
    } catch (error) {
      if (requestId !== modelRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "保存自定义 AI 失败";
      setCustomSaveError(message);
      toast.error(message, {
        description:
          action === "refresh"
            ? "模型列表未更新，已保留当前配置。"
            : "Base URL 与 API Key 已保存，模型列表未能更新。",
      });
    } finally {
      if (requestId === modelRequestIdRef.current) {
        setSavingCustomConfig(false);
      }
    }
  };

  const handleSaveCustomConfig = async () => {
    if (saveButtonReason) {
      toast.error(saveButtonReason);
      return;
    }
    await refreshCustomModels(getConnectionForProtocol(customProtocol), "save");
  };

  const handleProtocolChange = (value: string) => {
    const protocol = value as CustomAIProtocol;
    if (protocol === customProtocol) return;
    setCustomSaveError(null);
    setCustomProtocol(protocol);

    const connection = getConnectionForProtocol(protocol);
    const provider =
      CUSTOM_PROTOCOL_OPTIONS.find((option) => option.id === protocol) ??
      CUSTOM_PROTOCOL_OPTIONS[0];
    if (!connection.apiKey.trim()) {
      toast.info(`已切换到 ${provider.label}`, {
        description: "填写 API Key 并保存后，将自动获取模型列表。",
      });
      return;
    }
    void refreshCustomModels(connection, "switch");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-foreground">
          AI 助手
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          管理 AI 入口、模型和空格唤起。
        </p>
      </div>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Sparkles
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            AI 开关
          </span>
        }
        description="开启后页头出现 AI 入口；空白段落按空格可唤起 AI。"
      >
        <div
          className={cn(
            "flex items-center justify-between gap-4 p-4",
            SETTINGS_OPTION_ROW_CLASS,
          )}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <AiGradientIcon className="h-4 w-4" />
              <Label
                htmlFor="ai-enabled"
                className="cursor-pointer text-sm font-medium text-foreground"
              >
                启用 AI 写作助手
              </Label>
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              关闭后隐藏所有 AI 入口，并停止当前生成。
            </div>
          </div>
          <Switch
            id="ai-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Bot
              className="h-4 w-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
            AI 服务
          </span>
        }
        description="接入 OpenAI Responses、OpenAI 兼容或 Anthropic 服务。"
      >
        <div className="space-y-3">
          <div className="space-y-3">
            <div
              className={cn(
                "flex items-center justify-between gap-4 p-4",
                SETTINGS_OPTION_ROW_CLASS,
              )}
            >
              <div className="flex items-center gap-3">
                <LucideIcons.Server
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-foreground">
                    协议
                  </Label>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingCustomConfig}
                    className="min-w-[220px] justify-between rounded-[10px]"
                  >
                    <span className="truncate">{selectedProtocol.label}</span>
                    <LucideIcons.ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[280px]">
                  <DropdownMenuRadioGroup
                    value={customProtocol}
                    onValueChange={handleProtocolChange}
                  >
                    {CUSTOM_PROTOCOL_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.id}
                        value={option.id}
                        className="items-start gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {option.label}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {option.description}
                          </div>
                        </div>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className={cn("space-y-3 p-4", SETTINGS_OPTION_ROW_CLASS)}>
              <div className="flex items-center gap-3">
                <LucideIcons.Globe
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Label
                  htmlFor="custom-ai-base-url"
                  className="text-sm font-medium text-foreground"
                >
                  Base URL
                </Label>
              </div>
              <Input
                id="custom-ai-base-url"
                value={customBaseURL}
                onChange={(event) => {
                  setCustomSaveError(null);
                  const next = event.target.value;
                  if (customProtocol === "openai-responses") {
                    setCustomOpenAIResponsesBaseURL(next);
                    return;
                  }
                  if (customProtocol === "openai") {
                    setCustomOpenAIBaseURL(next);
                    return;
                  }
                  setCustomClaudeBaseURL(next);
                }}
                placeholder={
                  customProtocol === "claude"
                    ? DEFAULT_CLAUDE_BASE_URL
                    : DEFAULT_OPENAI_BASE_URL
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className={cn("space-y-3 p-4", SETTINGS_OPTION_ROW_CLASS)}>
              <div className="flex items-center gap-3">
                <LucideIcons.KeyRound
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Label
                  htmlFor="custom-ai-api-key"
                  className="text-sm font-medium text-foreground"
                >
                  API Key
                </Label>
              </div>
              <div className="relative">
                <Input
                  id="custom-ai-api-key"
                  type={apiKeyVisible ? "text" : "password"}
                  value={customApiKey}
                  onChange={(event) => {
                    setCustomSaveError(null);
                    if (customProtocol === "openai-responses") {
                      setCustomOpenAIResponsesApiKey(event.target.value);
                      return;
                    }
                    if (customProtocol === "openai") {
                      setCustomOpenAIApiKey(event.target.value);
                      return;
                    }
                    setCustomClaudeApiKey(event.target.value);
                  }}
                  placeholder="输入后点保存自动拉取模型"
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setApiKeyVisible((visible) => !visible)}
                  aria-label={apiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                  aria-pressed={apiKeyVisible}
                >
                  {apiKeyVisible ? (
                    <LucideIcons.EyeOff className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <LucideIcons.Eye className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-4 p-4",
                SETTINGS_OPTION_ROW_CLASS,
              )}
            >
              <div className="flex items-center gap-3">
                <LucideIcons.Download
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-foreground">
                    保存配置
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    保存 Base URL 与 API Key，并自动拉取可用模型列表。
                  </p>
                </div>
              </div>
              <TooltipProvider delayDuration={600}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        size="sm"
                        disabled={Boolean(saveButtonReason)}
                        onClick={() => {
                          void handleSaveCustomConfig();
                        }}
                        className={cn(
                          Boolean(saveButtonReason) && "cursor-not-allowed",
                        )}
                      >
                        {!savingCustomConfig && (
                          <LucideIcons.Save className="h-4 w-4" />
                        )}
                        {savingCustomConfig ? "保存中..." : "保存"}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {saveButtonReason ? (
                    <TooltipContent side="left">
                      {saveButtonReason}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </SettingsSectionCard>

      <div
        ref={modelSectionRef}
        id="ai-model-settings"
        tabIndex={-1}
        className="scroll-mt-6 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <SettingsSectionCard
          title={
            <span className="flex items-center gap-2">
              <LucideIcons.Brain
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              AI 模型
            </span>
          }
          description={
            <span className="block">
              选择全局默认模型；笔记本 AI
              如设置了工作区模型，会优先使用工作区模型。
              <span
                className="mt-1 block font-medium text-foreground/75"
                role="status"
                aria-live="polite"
              >
                {savingCustomConfig
                  ? "正在获取模型列表…"
                  : customSaveError
                    ? `获取失败：${customSaveError}`
                    : customModels.length > 0
                      ? `已获取 ${customModels.length} 个模型${currentModel ? `，当前默认：${currentModel.label}` : ""}`
                      : "尚未获取到模型。"}
              </span>
            </span>
          }
          actions={
            <Button
              variant="secondary"
              size="sm"
              disabled={Boolean(saveButtonReason)}
              onClick={() => {
                void refreshCustomModels(
                  getConnectionForProtocol(customProtocol),
                  "refresh",
                );
              }}
            >
              {savingCustomConfig ? (
                <LucideIcons.LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <LucideIcons.RefreshCw className="h-4 w-4" />
              )}
              {savingCustomConfig ? "获取中…" : "重新获取模型"}
            </Button>
          }
        >
          <div className="space-y-3">
            <div
              className={cn(
                "flex items-center justify-between gap-4 p-4",
                SETTINGS_OPTION_ROW_CLASS,
              )}
            >
              <div className="flex items-center gap-3">
                <LucideIcons.Cpu
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-foreground">
                    默认模型
                  </Label>
                </div>
              </div>
              <TooltipProvider delayDuration={600}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={modelButtonDisabled}
                            className={cn(
                              "min-w-[220px] justify-between rounded-[10px]",
                              modelButtonDisabled && "cursor-not-allowed",
                            )}
                          >
                            <span className="truncate">
                              {currentModel?.label ??
                                modelButtonReason ??
                                "请选择模型"}
                            </span>
                            <LucideIcons.ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-[280px]"
                          style={{
                            maxHeight:
                              "min(360px, var(--radix-dropdown-menu-content-available-height))",
                          }}
                        >
                          <DropdownMenuRadioGroup
                            value={selectedModelId ?? ""}
                            onValueChange={(value) => setSelectedModelId(value)}
                          >
                            {customModels.map((model) => (
                              <DropdownMenuRadioItem
                                key={model.id}
                                value={model.id}
                                className="items-start gap-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {model.label}
                                  </div>
                                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                    {model.description || model.id}
                                  </div>
                                </div>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TooltipTrigger>
                  {modelButtonReason ? (
                    <TooltipContent side="left">
                      {modelButtonReason}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </SettingsSectionCard>
      </div>
    </div>
  );
}
