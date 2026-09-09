import { CODEX_COMPOSER_SELECTOR, EDITOR_SELECTOR } from "./renderer-composer-dom.js";
import type { PromptEnhanceContext } from "./renderer-prompt-enhance.js";

interface Fiber {
  memoizedProps?: Record<string, unknown>;
  return?: Fiber | null;
  alternate?: Fiber | null;
}
function fiberFor(node: Element): Fiber | undefined {
  const key = Object.getOwnPropertyNames(node).find((key) => key.startsWith("__reactFiber$"));
  return key ? (node as unknown as Record<string, Fiber>)[key] : undefined;
}
interface EditIdentity {
  hostId: string | null;
  threadId: string | null;
  turnId: string | null;
}

/** Actual Desktop message-edit component contract, independent of localized copy/CSS. */
function editIdentity(form: Element): EditIdentity | null {
  if (form.tagName !== "FORM" || form.closest(CODEX_COMPOSER_SELECTOR)) return null;
  const editors = form.querySelectorAll(EDITOR_SELECTOR);
  if (editors.length !== 1 || !form.querySelector('button[type="submit"]')) return null;
  const root = fiberFor(form);
  const readBranch = (initial: Fiber | undefined): EditIdentity | null => {
    let contract = false;
    let hostId: string | null = null;
    let threadId: string | null = null;
    let turnId: string | null = null;
    // Follow the committed form ownership chain; never inspect unrelated sibling Fibers.
    let fiber = initial;
    for (let depth = 0; fiber && depth < 60; fiber = fiber.return ?? undefined, depth++) {
      const props = fiber.memoizedProps;
      if (!props) continue;
      if (
        typeof props.initialMessage === "string" &&
        typeof props.onCancel === "function" &&
        typeof props.onDraftChange === "function" &&
        typeof props.onSubmit === "function"
      )
        contract = true;
      if (!contract) continue;
      if (hostId === null && typeof props.hostId === "string" && props.hostId)
        hostId = props.hostId;
      if (threadId === null && typeof props.threadId === "string" && props.threadId)
        threadId = props.threadId;
      if (turnId === null && typeof props.turnId === "string" && props.turnId)
        turnId = props.turnId;
      if (threadId && turnId) break;
    }
    if (!contract) return null;
    turnId ??= form.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? null;
    return turnId ? { hostId, threadId, turnId } : null;
  };
  const first = readBranch(root);
  if (!root?.alternate) return first;
  const alternate = readBranch(root.alternate);
  // A reused host DOM node can still reference the previous committed Fiber.
  // Never assemble an identity from a mixture of two render generations.
  return first && alternate && JSON.stringify(first) === JSON.stringify(alternate) ? first : null;
}

export function enhancementTargets(document: Document): Element[] {
  return [
    ...document.querySelectorAll(CODEX_COMPOSER_SELECTOR),
    ...Array.from(document.querySelectorAll("form")).filter((form) => editIdentity(form) !== null),
  ];
}

export function enhancementContext(
  target: Element,
  getComposerContext: ((composer: Element) => PromptEnhanceContext | null) | undefined,
): PromptEnhanceContext | null {
  if (!target.isConnected) return null;
  if (target.matches(CODEX_COMPOSER_SELECTOR)) return getComposerContext?.(target) ?? null;
  const identity = editIdentity(target);
  if (!identity) return null;
  // Some supported versions inherit thread identity from the surrounding thread
  // view. Use only an unambiguous main Composer, never an arbitrary active input.
  const mains = target.ownerDocument.querySelectorAll(CODEX_COMPOSER_SELECTOR);
  const mainContext = mains.length === 1 && mains[0] ? getComposerContext?.(mains[0]) : null;
  if (!identity.threadId && !mainContext?.taskId) return null;
  return {
    taskId: JSON.stringify([
      "edit-message",
      identity.hostId,
      identity.threadId ?? mainContext?.taskId,
      identity.turnId,
      target.closest("[data-turn-key]")?.getAttribute("data-turn-key") ?? null,
      mainContext?.taskId ?? null,
    ]),
    navigationKey: target.ownerDocument.defaultView?.location.href ?? "",
  };
}

export function enhancementMutationRelevant(records: MutationRecord[]): boolean {
  const candidates = `${CODEX_COMPOSER_SELECTOR},form,${EDITOR_SELECTOR}`;
  return records.some((record) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (record.type === "attributes")
      return (
        !!target &&
        ((record.attributeName === "contenteditable" &&
          !!(target.closest(CODEX_COMPOSER_SELECTOR) || target.closest("form"))) ||
          target.matches(candidates) ||
          target.hasAttribute("data-turn-key") ||
          target.hasAttribute("data-above-composer-conversation-id") ||
          target.tagName === "BUTTON")
      );
    const withinTarget = !!(target?.closest(CODEX_COMPOSER_SELECTOR) || target?.closest("form"));
    return [...record.addedNodes, ...record.removedNodes].some(
      (node) =>
        node instanceof Element &&
        (node.matches(candidates) ||
          node.querySelector(candidates) !== null ||
          (withinTarget &&
            (node.matches("button,[data-codexhost-enhance-controls]") ||
              node.querySelector("button,[data-codexhost-enhance-controls]") !== null))),
    );
  });
}
