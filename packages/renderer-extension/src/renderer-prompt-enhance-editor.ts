interface ProseMirrorDoc {
  eq(other: unknown): boolean;
  childCount?: number;
  descendants?(
    visit: (node: { isLeaf: boolean; isText: boolean; type: { name: string } }) => void,
  ): void;
}
interface ProseMirrorState {
  doc: ProseMirrorDoc;
  tr: ProseMirrorTransaction;
}
interface ProseMirrorTransaction {
  doc: ProseMirrorDoc;
  setMeta(key: string, value: unknown): ProseMirrorTransaction;
}
interface ProseMirrorView {
  dom: Element;
  state: ProseMirrorState;
  isDestroyed: boolean;
  dispatch(tr: ProseMirrorTransaction): void;
  composing?: boolean;
}
interface ComposerController {
  view: ProseMirrorView;
  getText(): string;
  setText(value: string): void;
  undo(): void;
}

export interface EnhancementEditor {
  read(): string;
  snapshot(): unknown;
  equals(snapshot: unknown): boolean;
  write(text: string): boolean;
  undo(before: unknown): boolean;
  isComposing(): boolean;
  isValid(): boolean;
  dispose(): void;
}

function controllerFor(editor: Element): ComposerController | null {
  for (
    let node: Element | null = editor, depth = 0;
    node && depth < 10;
    node = node.parentElement, depth += 1
  ) {
    const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactFiber$"));
    const fiber = key
      ? ((node as unknown as Record<string, unknown>)[key] as
          { alternate?: unknown; return?: unknown; memoizedProps?: unknown } | undefined)
      : undefined;
    for (const branch of [fiber, fiber?.alternate as typeof fiber | undefined]) {
      let current = branch;
      for (
        let count = 0;
        current && count < 16;
        current = current.return as typeof current | undefined, count += 1
      ) {
        const props = current.memoizedProps as { composerController?: unknown } | undefined;
        const candidate = props?.composerController as Partial<ComposerController> | undefined;
        if (
          candidate?.view?.dom === editor &&
          !candidate.view.isDestroyed &&
          typeof candidate.getText === "function" &&
          typeof candidate.setText === "function" &&
          typeof candidate.undo === "function"
        )
          return candidate as ComposerController;
      }
    }
  }
  return null;
}

function editableVisible(editor: Element): boolean {
  if (
    !editor.isConnected ||
    editor.closest("[inert]") ||
    (editor as HTMLInputElement).disabled ||
    (editor as HTMLInputElement).readOnly
  )
    return false;
  return (
    editor.getAttribute("contenteditable") === "true" ||
    editor.tagName === "TEXTAREA" ||
    editor.tagName === "INPUT"
  );
}

export function createEnhancementEditor(editor: Element): EnhancementEditor | null {
  if (!editableVisible(editor)) return null;
  const composing = { value: false };
  const onStart = () => (composing.value = true);
  const onEnd = () => (composing.value = false);
  editor.addEventListener("compositionstart", onStart);
  editor.addEventListener("compositionend", onEnd);
  const isText = editor.tagName === "TEXTAREA" || editor.tagName === "INPUT";
  const pm = editor.classList.contains("ProseMirror") ? controllerFor(editor) : null;
  if (editor.classList.contains("ProseMirror") && !pm) {
    editor.removeEventListener("compositionstart", onStart);
    editor.removeEventListener("compositionend", onEnd);
    return null;
  }
  if (!isText && !pm) {
    editor.removeEventListener("compositionstart", onStart);
    editor.removeEventListener("compositionend", onEnd);
    return null;
  }
  const textOnly = () => {
    if (!pm) return true;
    if (!pm.view.state.doc.descendants) return false;
    let supported = true;
    pm.view.state.doc.descendants((node) => {
      if (node.isLeaf && !node.isText && !["hard_break", "hardBreak"].includes(node.type.name))
        supported = false;
    });
    return supported;
  };
  const read = () => {
    if (!textOnly())
      throw new Error("Composer contains non-text nodes; enhancement is unavailable");
    return pm ? pm.getText() : (editor as HTMLTextAreaElement).value;
  };
  const snapshot = () => (pm ? pm.view.state.doc : read());
  const writeText = (text: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value");
    if (descriptor?.set) descriptor.set.call(editor, text);
    else (editor as HTMLTextAreaElement).value = text;
    const InputCtor = globalThis.InputEvent;
    editor.dispatchEvent(
      InputCtor
        ? new InputCtor("input", { bubbles: true, inputType: "insertText", data: text })
        : new Event("input", { bubbles: true }),
    );
    return true;
  };
  return {
    read,
    snapshot,
    equals: (value) => (pm ? pm.view.state.doc.eq(value) : read() === value),
    write: (text) => {
      if (!textOnly()) return false;
      if (!pm) {
        return writeText(text);
      }
      if (!pm.view.state.doc || pm.view.isDestroyed) return false;
      pm.view.dispatch(pm.view.state.tr.setMeta("closeHistory$", true));
      let transaction: ProseMirrorTransaction | undefined;
      const facade = Object.create(pm) as ComposerController;
      facade.view = { ...pm.view, state: pm.view.state, dispatch: (tr) => (transaction = tr) };
      pm.setText.call(facade, text);
      if (!transaction) return false;
      pm.view.dispatch(transaction);
      pm.view.dispatch(pm.view.state.tr.setMeta("closeHistory$", true));
      return pm.view.state.doc.eq(transaction.doc);
    },
    undo: (before) => {
      if (!pm) return typeof before === "string" ? writeText(before) : false;
      if (!before || !pm.view.state.doc.eq(snapshot())) return false;
      let candidate: ProseMirrorTransaction | undefined;
      const facade = Object.create(pm) as ComposerController;
      facade.view = { ...pm.view, state: pm.view.state, dispatch: (tr) => (candidate = tr) };
      pm.undo.call(facade);
      if (!candidate || !candidate.doc.eq(before)) return false;
      pm.view.dispatch(candidate);
      return pm.view.state.doc.eq(before);
    },
    isComposing: () => composing.value || Boolean(pm?.view.composing),
    isValid: () =>
      editableVisible(editor) && (!pm || (pm.view.dom === editor && !pm.view.isDestroyed)),
    dispose: () => {
      editor.removeEventListener("compositionstart", onStart);
      editor.removeEventListener("compositionend", onEnd);
    },
  };
}
