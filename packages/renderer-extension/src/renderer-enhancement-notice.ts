/** Transient, dismissible feedback outside the Composer layout. */
export function createEnhancementNotice(document: Document) {
  const root = document.createElement("div");
  root.dataset.codexhostEnhanceNotice = "true";
  root.hidden = true;
  root.style.cssText =
    "position:fixed;right:20px;bottom:120px;z-index:2147483646;max-width:min(420px,calc(100vw - 40px));padding:10px 12px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 4px 16px #0003;font-size:13px";
  const text = document.createElement("span");
  text.setAttribute("role", "status");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "关闭提示");
  close.style.cssText =
    "margin-left:12px;cursor:pointer;background:transparent;color:inherit;border:0;font-size:18px";
  root.append(text, close);
  document.body.append(root);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let duration = 0;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const hide = () => {
    clear();
    if (!root.hidden) root.hidden = true;
  };
  const schedule = () => {
    clear();
    if (duration > 0) timer = setTimeout(hide, duration);
  };
  close.addEventListener("click", hide);
  root.addEventListener("mouseenter", clear);
  root.addEventListener("mouseleave", () => {
    if (!root.hidden) schedule();
  });
  return {
    show(message: string, anchor: HTMLElement, timeout = 6000) {
      clear();
      duration = timeout;
      text.textContent = message;
      const rect = anchor.getBoundingClientRect();
      const height = document.defaultView?.innerHeight ?? 800;
      root.style.bottom = `${Math.max(16, height - rect.top + 12)}px`;
      root.hidden = false;
      schedule();
    },
    hide,
    dispose() {
      clear();
      root.remove();
    },
  };
}

export function enhancementFailureMessage(error: unknown): string {
  const value =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; name?: unknown })
      : {};
  if (
    value.code === -32601 ||
    value.code === -32600 ||
    /unknown variant|unsupported on this Host/i.test(String(value.message ?? ""))
  )
    return "界面与 Host 版本不匹配，请完全退出并重新打开 CodexHost。";
  const message = String(value.message ?? "");
  if (/API key|credential|disabled|not configured/i.test(message))
    return "请右键打开设置，启用增强并填写 API Key、地址和模型，然后保存。";
  const http = message.match(/HTTP (\d{3})/);
  if (http) return `模型服务返回 HTTP ${http[1]}，请检查 API Key、模型和地址。`;
  return "增强失败，原稿已保留。请检查设置；完整结果可在设置中复制。";
}
