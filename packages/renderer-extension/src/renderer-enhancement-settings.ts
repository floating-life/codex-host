import { promptEnhanceConfigSchema } from "@codexhost/shared-contracts";

type Send = (method: string, params: unknown) => Promise<unknown>;
const dialogCleanups = new WeakMap<HTMLDialogElement, () => void>();

/** Same form is used by the native Settings shell and the composer shortcut. */
export function mountEnhancementSettings(
  content: HTMLElement,
  send: Send,
  getResult: () => string | null = () => null,
): () => void {
  const document = content.ownerDocument;
  let disposed = false;
  const form = document.createElement("form");
  form.dataset.codexhostPromptEnhanceSettings = "true";
  form.style.cssText = "display:grid;gap:12px;max-width:650px";
  const heading = document.createElement("h2");
  heading.textContent = "Prompt Enhance · 提示词增强";
  const notice = document.createElement("p");
  notice.textContent =
    "只在点击增强时，将当前草稿发送给以下 Provider。不会发送聊天历史或附件内容，不会自动发送任务。API 可能计费。";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "正在读取配置…";
  const fieldset = document.createElement("fieldset");
  fieldset.style.cssText = "display:grid;gap:10px;border:0;padding:0;min-width:0";
  fieldset.disabled = true;
  const addField = (title: string, element: HTMLInputElement | HTMLSelectElement) => {
    const label = document.createElement("label");
    label.style.cssText = "display:grid;gap:4px";
    label.append(document.createTextNode(title), element);
    fieldset.append(label);
    return element;
  };
  const input = (name: string, type = "text") => {
    const element = document.createElement("input");
    element.type = type;
    element.name = name;
    element.autocomplete = "off";
    element.style.cssText =
      "padding:6px;border:1px solid GrayText;border-radius:4px;background:Canvas;color:CanvasText";
    return element;
  };
  const select = (name: string, entries: [string, string][]) => {
    const element = document.createElement("select");
    element.name = name;
    for (const [value, text] of entries) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      element.append(option);
    }
    return element;
  };
  const enabled = input("enabled", "checkbox");
  addField("启用增强", enabled);
  const mode = select("mode", [
    ["workbuddy", "WorkBuddy 风格（简洁）"],
    ["creative", "创意增强（展开需求）"],
  ]);
  addField("增强模式", mode);
  const protocol = select("protocol", [
    ["chat-completions", "Chat Completions"],
    ["responses", "Responses"],
  ]);
  addField("协议", protocol);
  const baseUrl = input("baseUrl", "url");
  addField("Base URL（包含 /v1，如服务需要）", baseUrl);
  const model = input("model");
  addField("模型 ID", model);
  const credentialMode = select("credentialMode", [
    ["manual", "手动填写（默认）"],
    ["environment", "环境变量（高级）"],
  ]);
  addField("凭据方式", credentialMode);
  const apiKey = input("apiKey", "password");
  addField("API Key", apiKey);
  apiKey.placeholder = "填写 API Key";
  const clearApiKey = input("clearApiKey", "checkbox");
  addField("清除已保存的 Key", clearApiKey);
  apiKey.addEventListener("input", () => {
    if (apiKey.value) clearApiKey.checked = false;
  });
  clearApiKey.addEventListener("change", () => {
    if (clearApiKey.checked) apiKey.value = "";
  });
  const apiKeyEnv = input("apiKeyEnv");
  addField("API Key 环境变量名（不是 Key 本身）", apiKeyEnv);
  apiKeyEnv.placeholder = "PROMPT_ENHANCE_API_KEY";
  const help = document.createElement("p");
  help.textContent =
    "保存后下一次增强立即使用新配置，无需重启。Key 仅保存在本机 Host 配置中，不回显；留空保留已保存的 Key。正在进行的增强继续使用发起时的配置。";
  const updateCredentials = () => {
    const manual = credentialMode.value === "manual";
    const keyLabel = apiKey.closest("label");
    if (keyLabel) keyLabel.hidden = !manual;
    const clearLabel = clearApiKey.closest("label");
    if (clearLabel) clearLabel.hidden = !manual;
    const envLabel = apiKeyEnv.closest("label");
    if (envLabel) envLabel.hidden = manual;
  };
  credentialMode.addEventListener("change", updateCredentials);
  updateCredentials();
  fieldset.append(help);
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "保存配置";
  fieldset.append(save);
  const resultLabel = document.createElement("label");
  resultLabel.textContent = "最近一次完整增强结果（仅本页内存，刷新后丢失）";
  const result = document.createElement("textarea");
  result.readOnly = true;
  result.rows = 6;
  result.value = getResult() ?? "";
  result.style.cssText = "display:block;width:100%;white-space:pre-wrap";
  resultLabel.append(result);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制结果";
  copy.addEventListener("click", () => {
    result.value = getResult() ?? "";
    const clipboard = document.defaultView?.navigator.clipboard;
    if (!result.value || !clipboard) {
      status.textContent = "可在结果框中选中并复制。";
      return;
    }
    void clipboard.writeText(result.value).then(
      () => {
        if (!disposed) status.textContent = "已复制。";
      },
      () => {
        if (!disposed) status.textContent = "复制失败，请在结果框中手动复制。";
      },
    );
  });
  form.append(heading, notice, status, fieldset, resultLabel, copy);
  content.append(form);
  const apply = (value: unknown) => {
    const config = promptEnhanceConfigSchema.parse(value);
    enabled.checked = config.enabled;
    mode.value = config.mode;
    protocol.value = config.protocol;
    baseUrl.value = config.baseUrl;
    model.value = config.model;
    credentialMode.value = config.credentialMode ?? "manual";
    apiKey.value = "";
    clearApiKey.checked = false;
    apiKey.placeholder = config.hasApiKey ? "已保存（留空保留，输入新值替换）" : "填写 API Key";
    apiKeyEnv.value = config.apiKeyEnv ?? "";
    updateCredentials();
  };
  void send("codexhost/prompt-enhance/config/read", {}).then(
    (value) => {
      if (disposed) return;
      try {
        apply(value);
        fieldset.disabled = false;
        status.textContent = "";
      } catch {
        status.textContent = "Host 配置格式不兼容。";
      }
    },
    () => {
      if (!disposed)
        status.textContent =
          "无法读取 Host 配置。若刚更新过模块，请完全退出并重新打开 CodexHost，以加载配套 Host。";
    },
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (fieldset.disabled || disposed) return;
    fieldset.disabled = true;
    status.textContent = "正在保存…";
    void send("codexhost/prompt-enhance/config/write", {
      enabled: enabled.checked,
      mode: mode.value,
      protocol: protocol.value,
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      credentialMode: credentialMode.value,
      ...(credentialMode.value === "manual" && apiKey.value ? { apiKey: apiKey.value } : {}),
      ...(credentialMode.value === "manual" && clearApiKey.checked ? { clearApiKey: true } : {}),
      ...(apiKeyEnv.value.trim() ? { apiKeyEnv: apiKeyEnv.value.trim() } : {}),
    })
      .then(
        (value) => {
          if (disposed) return;
          try {
            apply(value);
            status.textContent = "配置已保存，下一次增强立即生效。";
          } catch {
            status.textContent = "Host 返回的配置格式不兼容。";
          }
        },
        () => {
          if (!disposed)
            status.textContent = "保存失败，请检查 URL、模型和凭据；原配置未确认变更。";
        },
      )
      .finally(() => {
        if (!disposed) fieldset.disabled = false;
      });
  });
  return () => {
    disposed = true;
    apiKey.value = "";
    form.remove();
  };
}

export function openEnhancementSettings(
  document: Document,
  send: Send,
  getResult: () => string | null,
): () => void {
  const old = document.querySelector<HTMLDialogElement>("dialog[data-codexhost-enhance-dialog]");
  if (old) {
    old.focus();
    return dialogCleanups.get(old) ?? (() => old.remove());
  }
  const dialog = document.createElement("dialog");
  dialog.dataset.codexhostEnhanceDialog = "true";
  dialog.setAttribute("aria-label", "Prompt Enhance 设置");
  dialog.style.cssText =
    "max-width:720px;width:85vw;max-height:85vh;overflow:auto;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:8px;padding:20px";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "关闭";
  dialog.append(close);
  document.body.append(dialog);
  const cleanup = mountEnhancementSettings(dialog, send, getResult);
  const dispose = () => {
    cleanup();
    dialogCleanups.delete(dialog);
    dialog.remove();
  };
  dialogCleanups.set(dialog, dispose);
  close.addEventListener("click", dispose);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dispose();
  });
  dialog.showModal();
  return dispose;
}
