"use client";

import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shell/page-header";
import {
  LLM_PROVIDERS,
  getProviderCategories,
  type LlmProvider,
} from "@/lib/evaluators/providers";

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface Settings {
  activeConfigId: string | null;
  configs: ModelConfig[];
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ activeConfigId: null, configs: [] });
  const [loading, setLoading] = useState(true);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => setSettings({ activeConfigId: null, configs: [] }))
      .finally(() => setLoading(false));
  }, []);

  const handleAddConfig = () => {
    const newConfig: ModelConfig = {
      id: `cfg_${Date.now()}`,
      name: "新配置",
      provider: "openai",
      apiKey: "",
      baseUrl: LLM_PROVIDERS[0].baseUrl,
      model: LLM_PROVIDERS[0].defaultModel,
    };
    setEditingConfig(newConfig);
  };

  const handleProviderChange = (providerId: string) => {
    if (!editingConfig) return;
    const provider = LLM_PROVIDERS.find((p) => p.id === providerId);
    if (provider) {
      setEditingConfig({
        ...editingConfig,
        provider: providerId,
        baseUrl: provider.baseUrl,
        model: provider.defaultModel,
      });
    }
  };

  const saveToDatabase = async (newSettings: Settings) => {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
    } catch {
      // silently fail
    }
  };

  const handleSaveConfig = () => {
    if (!editingConfig) return;
    const exists = settings.configs.find((c) => c.id === editingConfig.id);
    let newConfigs: ModelConfig[];
    if (exists) {
      newConfigs = settings.configs.map((c) => (c.id === editingConfig.id ? editingConfig : c));
    } else {
      newConfigs = [...settings.configs, editingConfig];
    }
    const newSettings = { ...settings, configs: newConfigs };
    setSettings(newSettings);
    setEditingConfig(null);
    saveToDatabase(newSettings);
  };

  const handleDeleteConfig = (id: string) => {
    const newSettings = {
      ...settings,
      configs: settings.configs.filter((c) => c.id !== id),
      activeConfigId: settings.activeConfigId === id ? null : settings.activeConfigId,
    };
    setSettings(newSettings);
    saveToDatabase(newSettings);
  };

  const handleSetActive = (id: string) => {
    const newSettings = { ...settings, activeConfigId: id };
    setSettings(newSettings);
    saveToDatabase(newSettings);
  };

  const toggleShowApiKey = (id: string) => {
    setShowApiKey((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="设置"
        description="配置 LLM 模型提供商和 API Key（自动保存）"
      />

      {/* 模型配置列表 */}
      <Card>
        <CardHeader className="border-b border-border/60 pb-2.5">
          <div className="flex items-center justify-between">
            <CardTitle>模型配置</CardTitle>
            <Button size="sm" variant="outline" onClick={handleAddConfig}>
              <Plus />
              添加配置
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.configs.length === 0 && !editingConfig && (
            <p className="text-sm text-muted-foreground text-center py-6">
              暂无模型配置，点击"添加配置"开始
            </p>
          )}
          {settings.configs.map((config) => (
            <div
              key={config.id}
              className={`flex items-center justify-between rounded-md p-3 ring-1 ${
                settings.activeConfigId === config.id
                  ? "bg-primary/5 ring-primary/40"
                  : "ring-foreground/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <Bot className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{config.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {LLM_PROVIDERS.find((p) => p.id === config.provider)?.name || config.provider}
                    </Badge>
                    {settings.activeConfigId === config.id && (
                      <Badge variant="default" className="text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        使用中
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {config.model} · {config.baseUrl || "默认地址"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.activeConfigId !== config.id && (
                  <Button variant="ghost" size="sm" onClick={() => handleSetActive(config.id)}>
                    设为默认
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditingConfig(config)}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteConfig(config.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 编辑/新增配置 */}
      {editingConfig && (
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 border-b border-border/60 pb-2.5">
            <CardTitle>
              {settings.configs.find((c) => c.id === editingConfig.id) ? "编辑配置" : "新增配置"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">配置名称</label>
              <Input
                value={editingConfig.name}
                onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                placeholder="如：生产环境 GPT-4o"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">提供商</label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {getProviderCategories().map((cat) => (
                  <div key={cat.id} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{cat.name}</p>
                    {LLM_PROVIDERS.filter((p) => p.category === cat.id).map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => handleProviderChange(provider.id)}
                        className={`w-full text-left rounded-md border px-2.5 py-1.5 text-xs transition-all ${
                          editingConfig.provider === provider.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        {provider.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">API Key</label>
              <div className="flex gap-2">
                <Input
                  type={showApiKey[editingConfig.id] ? "text" : "password"}
                  value={editingConfig.apiKey}
                  onChange={(e) => setEditingConfig({ ...editingConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleShowApiKey(editingConfig.id)}
                >
                  {showApiKey[editingConfig.id] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Base URL</label>
              <Input
                value={editingConfig.baseUrl}
                onChange={(e) => setEditingConfig({ ...editingConfig, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">模型</label>
              <Input
                value={editingConfig.model}
                onChange={(e) => setEditingConfig({ ...editingConfig, model: e.target.value })}
                placeholder="gpt-4o"
              />
              {editingConfig.provider && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {LLM_PROVIDERS.find((p) => p.id === editingConfig.provider)?.suggestedModels.map(
                    (model) => (
                      <button
                        key={model}
                        onClick={() => setEditingConfig({ ...editingConfig, model })}
                        className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-primary/30 hover:bg-primary/5"
                      >
                        {model}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveConfig}>
                <Check className="h-4 w-4 mr-1.5" />
                确认
              </Button>
              <Button variant="ghost" onClick={() => setEditingConfig(null)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
