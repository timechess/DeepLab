import { Extension, getChangedRanges } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import katex, { type KatexOptions } from "katex";

type MathDecorationSpec = {
  content: string;
  displayMode: boolean;
  isEditable: boolean;
  isEditing: boolean;
  katexOptions?: KatexOptions;
};

type MathMatch = {
  from: number;
  to: number;
  content: string;
  displayMode: boolean;
};

type MathematicsPluginState =
  | {
      decorations: DecorationSet;
      isEditable: boolean;
    }
  | {
      decorations: undefined;
      isEditable: undefined;
    };

export type InlineDisplayMathematicsOptions = {
  katexOptions?: KatexOptions;
  shouldRender: (state: any, pos: number, node: any) => boolean;
};

const DISPLAY_MATH_REGEX = /^\s*\$\$([\s\S]+?)\$\$\s*$/;
const INLINE_MATH_REGEX = /(?<!\$)\$([^$\n]+)\$(?!\$)/g;
const MATH_EDITOR_CLASS = "Tiptap-mathematics-editor";
const MATH_EDITOR_HIDDEN_CLASS = "Tiptap-mathematics-editor--hidden";
const MATH_DISPLAY_FENCE_CLASS = "Tiptap-math-display-fence";
const MATH_DISPLAY_FENCE_HIDDEN_CLASS = "Tiptap-math-display-fence--hidden";
const MATH_PREVIEW_CLASS = "Tiptap-math-hover-preview";
const MATH_PREVIEW_ERROR_CLASS = "Tiptap-math-hover-preview--error";
const HIDDEN_INLINE_STYLE =
  "display:inline-block;height:0;opacity:0;overflow:hidden;position:absolute;width:0;";

type ActiveMathPreview = {
  anchor: HTMLElement;
  element: HTMLDivElement;
};

function detectInlineMathMatches(text: string): MathMatch[] {
  const matches: MathMatch[] = [];
  let matched = INLINE_MATH_REGEX.exec(text);
  while (matched) {
    const content = String(matched[1] || "").trim();
    if (!content) {
      matched = INLINE_MATH_REGEX.exec(text);
      continue;
    }
    matches.push({
      from: matched.index,
      to: matched.index + matched[0].length,
      content,
      displayMode: false,
    });
    matched = INLINE_MATH_REGEX.exec(text);
  }
  INLINE_MATH_REGEX.lastIndex = 0;
  return matches;
}

function detectDisplayMathFromTextblock(text: string): string | null {
  const matched = text.match(DISPLAY_MATH_REGEX);
  if (!matched) {
    return null;
  }
  const content = (matched[1] ?? "").trim();
  return content || null;
}

function detectDisplayMathWithTrailingFence(text: string): {
  content: string;
  contentLength: number;
} | null {
  const matched = text.match(/^([\s\S]*?)\$\$\s*$/);
  if (!matched) {
    return null;
  }
  const prefix = matched[1] ?? "";
  if (!prefix || prefix.includes("$$")) {
    return null;
  }
  const content = prefix.trim();
  if (!content) {
    return null;
  }
  return { content, contentLength: prefix.length };
}

function isDisplayFenceParagraph(node: {
  type?: { name?: string };
  textContent: string;
}): boolean {
  return node.type?.name === "paragraph" && node.textContent.trim() === "$$";
}

function isSelectionOnDisplayFenceParagraph(state: any): boolean {
  const { selection } = state;
  if (!selection?.empty) {
    return false;
  }
  const parent = selection.$from?.parent;
  return (
    parent?.type?.name === "paragraph" &&
    typeof parent.textContent === "string" &&
    parent.textContent.trim() === "$$"
  );
}

function rangesOverlap(
  from: number,
  to: number,
  minFrom: number,
  maxTo: number,
): boolean {
  return from < maxTo && to > minFrom;
}

function isSelectionInsideRange(
  selection: { from: number; to: number; anchor: number },
  from: number,
  to: number,
): boolean {
  const selectionSize = selection.to - selection.from;
  const anchorIsInside = selection.anchor >= from && selection.anchor <= to;
  const rangeIsInside = selection.from >= from && selection.to <= to;
  return (selectionSize === 0 && anchorIsInside) || rangeIsInside;
}

function getAffectedRange(
  newState: any,
  previousPluginState: MathematicsPluginState,
  isEditable: boolean,
  tr: any,
  state: any,
): { minFrom: number; maxTo: number } {
  const docSize = newState.doc.nodeSize - 2;
  let minFrom = 0;
  let maxTo = docSize;

  if (previousPluginState.isEditable !== isEditable) {
    minFrom = 0;
    maxTo = docSize;
  } else if (tr.docChanged) {
    minFrom = docSize;
    maxTo = 0;
    getChangedRanges(tr).forEach((range) => {
      minFrom = Math.min(
        minFrom,
        range.newRange.from - 1,
        range.oldRange.from - 1,
      );
      maxTo = Math.max(maxTo, range.newRange.to + 1, range.oldRange.to + 1);
    });
  } else if (tr.selectionSet) {
    if (
      isSelectionOnDisplayFenceParagraph(state) ||
      isSelectionOnDisplayFenceParagraph(newState)
    ) {
      minFrom = 0;
      maxTo = docSize;
      return { minFrom, maxTo };
    }
    const { $from, $to } = state.selection;
    const { $from: $newFrom, $to: $newTo } = newState.selection;
    minFrom = Math.min(
      $from.depth === 0 ? 0 : $from.before(),
      $newFrom.depth === 0 ? 0 : $newFrom.before(),
    );
    maxTo = Math.max(
      $to.depth === 0 ? maxTo : $to.after(),
      $newTo.depth === 0 ? maxTo : $newTo.after(),
    );
  }

  return {
    minFrom: Math.max(minFrom, 0),
    maxTo: Math.min(maxTo, docSize),
  };
}

function readPreviewPayload(anchor: HTMLElement): {
  content: string;
  displayMode: boolean;
} | null {
  const encoded = anchor.getAttribute("data-math-content");
  const displayMode = anchor.getAttribute("data-math-display-mode");
  if (!encoded || displayMode == null) {
    return null;
  }

  try {
    return {
      content: decodeURIComponent(encoded),
      displayMode: displayMode === "true",
    };
  } catch {
    return null;
  }
}

function positionMathPreview(anchor: HTMLElement, preview: HTMLDivElement) {
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 10;
  const spacing = 8;
  const previewWidth = preview.offsetWidth;
  const previewHeight = preview.offsetHeight;
  const top = rect.top - previewHeight - spacing;
  const targetRight = rect.right - previewWidth;
  const fallbackTop = rect.bottom + spacing;
  const left = Math.max(
    viewportPadding,
    Math.min(targetRight, window.innerWidth - previewWidth - viewportPadding),
  );
  const clampedTop =
    top < viewportPadding
      ? Math.min(
          fallbackTop,
          window.innerHeight - previewHeight - viewportPadding,
        )
      : Math.min(top, window.innerHeight - previewHeight - viewportPadding);

  preview.style.top = `${Math.max(viewportPadding, clampedTop)}px`;
  preview.style.left = `${left}px`;
}

function toMathSource(content: string, displayMode: boolean): string {
  return displayMode ? `$$${content}$$` : `$${content}$`;
}

export const InlineDisplayMathematics =
  Extension.create<InlineDisplayMathematicsOptions>({
    name: "InlineDisplayMathematics",

    addOptions() {
      return {
        katexOptions: undefined,
        shouldRender: (state: any, pos: number) => {
          const $pos = state.doc.resolve(pos);
          return $pos.parent.type.name !== "codeBlock";
        },
      };
    },

    addProseMirrorPlugins() {
      const { katexOptions, shouldRender } = this.options;
      const editor = this.editor;
      let activeMathPreview: ActiveMathPreview | null = null;
      let removeWindowListeners: (() => void) | null = null;

      const hideMathPreview = () => {
        if (activeMathPreview?.element.parentNode) {
          activeMathPreview.element.parentNode.removeChild(
            activeMathPreview.element,
          );
        }
        activeMathPreview = null;
        removeWindowListeners?.();
        removeWindowListeners = null;
      };

      const renderPreviewContent = (
        preview: HTMLDivElement,
        payload: { content: string; displayMode: boolean },
      ) => {
        let content = preview.querySelector<HTMLDivElement>(
          `.${MATH_PREVIEW_CLASS}-content`,
        );
        if (!content) {
          content = document.createElement("div");
          content.className = `${MATH_PREVIEW_CLASS}-content`;
          preview.append(content);
        }
        content.textContent = "";
        preview.classList.remove(MATH_PREVIEW_ERROR_CLASS);
        try {
          katex.render(payload.content, content, {
            ...katexOptions,
            displayMode: payload.displayMode,
            throwOnError: true,
          });
        } catch {
          preview.classList.add(MATH_PREVIEW_ERROR_CLASS);
          content.textContent = toMathSource(
            payload.content,
            payload.displayMode,
          );
        }
      };

      const syncPreviewPosition = () => {
        if (!activeMathPreview) {
          return;
        }
        positionMathPreview(
          activeMathPreview.anchor,
          activeMathPreview.element,
        );
      };

      const ACTIVE_EDITOR_SELECTOR = `.${MATH_EDITOR_CLASS}[data-math-active="true"]`;

      const findActiveMathAnchor = (view: { dom: HTMLElement }) => {
        const domSelection = view.dom.ownerDocument.getSelection();
        const candidateNodes = [
          domSelection?.anchorNode,
          domSelection?.focusNode,
        ];
        for (const node of candidateNodes) {
          if (!node) {
            continue;
          }
          if (node instanceof HTMLElement) {
            const matched = node.closest(ACTIVE_EDITOR_SELECTOR);
            if (matched instanceof HTMLElement) {
              return matched;
            }
          }
          const parent = node.parentElement;
          if (!parent) {
            continue;
          }
          const matched = parent.closest(ACTIVE_EDITOR_SELECTOR);
          if (matched instanceof HTMLElement) {
            return matched;
          }
        }
        const fallback = view.dom.querySelector(ACTIVE_EDITOR_SELECTOR);
        return fallback instanceof HTMLElement ? fallback : null;
      };

      const showMathPreview = (anchor: HTMLElement) => {
        const payload = readPreviewPayload(anchor);
        if (!payload) {
          hideMathPreview();
          return;
        }

        if (activeMathPreview?.anchor === anchor) {
          renderPreviewContent(activeMathPreview.element, payload);
          syncPreviewPosition();
          return;
        }

        hideMathPreview();
        const preview = document.createElement("div");
        preview.className = MATH_PREVIEW_CLASS;
        renderPreviewContent(preview, payload);
        document.body.append(preview);
        positionMathPreview(anchor, preview);

        window.addEventListener("scroll", syncPreviewPosition, true);
        window.addEventListener("resize", syncPreviewPosition);
        removeWindowListeners = () => {
          window.removeEventListener("scroll", syncPreviewPosition, true);
          window.removeEventListener("resize", syncPreviewPosition);
        };

        activeMathPreview = {
          anchor,
          element: preview,
        };
      };

      return [
        new Plugin<MathematicsPluginState>({
          key: new PluginKey("inline-display-mathematics"),
          state: {
            init() {
              return { decorations: undefined, isEditable: undefined };
            },
            apply(tr, previousPluginState, state, newState) {
              if (
                !tr.docChanged &&
                !tr.selectionSet &&
                previousPluginState.decorations
              ) {
                return previousPluginState;
              }

              const nextDecorationSet = (
                previousPluginState.decorations || DecorationSet.empty
              ).map(tr.mapping, tr.doc);
              const selection = newState.selection;
              const isEditable = editor.isEditable;
              const decorationsToAdd: Decoration[] = [];
              const docSize = newState.doc.nodeSize - 2;
              const shouldRebuildEntireDoc =
                tr.docChanged || previousPluginState.isEditable !== isEditable;
              const { minFrom, maxTo } = shouldRebuildEntireDoc
                ? { minFrom: 0, maxTo: docSize }
                : getAffectedRange(
                    newState,
                    previousPluginState,
                    isEditable,
                    tr,
                    state,
                  );
              const nextDecorationSetWithoutAffected = nextDecorationSet.remove(
                nextDecorationSet.find(minFrom, maxTo),
              );
              const addMathDecorations = (
                from: number,
                to: number,
                content: string,
                displayMode: boolean,
              ) => {
                if (!content || to <= from) {
                  return;
                }
                const isEditing = isSelectionInsideRange(selection, from, to);

                if (
                  nextDecorationSetWithoutAffected.find(
                    from,
                    to,
                    (spec: MathDecorationSpec) =>
                      spec.isEditing === isEditing &&
                      spec.content === content &&
                      spec.displayMode === displayMode &&
                      spec.isEditable === isEditable &&
                      spec.katexOptions === katexOptions,
                  ).length
                ) {
                  return;
                }

                decorationsToAdd.push(
                  Decoration.inline(
                    from,
                    to,
                    {
                      class:
                        isEditing && isEditable
                          ? MATH_EDITOR_CLASS
                          : `${MATH_EDITOR_CLASS} ${MATH_EDITOR_HIDDEN_CLASS}`,
                      style:
                        !isEditing || !isEditable
                          ? HIDDEN_INLINE_STYLE
                          : undefined,
                      "data-math-content": encodeURIComponent(content),
                      "data-math-display-mode": String(displayMode),
                      "data-math-active": String(isEditing && isEditable),
                    },
                    {
                      content,
                      displayMode,
                      isEditable,
                      isEditing,
                      katexOptions,
                    } satisfies MathDecorationSpec,
                  ),
                );

                if (!isEditable || !isEditing) {
                  decorationsToAdd.push(
                    Decoration.widget(
                      from,
                      () => {
                        const element = document.createElement("span");
                        element.classList.add("Tiptap-mathematics-render");
                        if (displayMode) {
                          element.classList.add(
                            "Tiptap-mathematics-render--display",
                          );
                        }
                        if (isEditable) {
                          element.classList.add(
                            "Tiptap-mathematics-render--editable",
                          );
                        }
                        try {
                          katex.render(content, element, {
                            ...katexOptions,
                            displayMode,
                            throwOnError: false,
                          });
                        } catch {
                          element.textContent = content;
                        }
                        return element;
                      },
                      {
                        content,
                        displayMode,
                        isEditable,
                        isEditing,
                        katexOptions,
                      } satisfies MathDecorationSpec,
                    ),
                  );
                }
              };

              const addDisplayFenceDecoration = (
                from: number,
                to: number,
                shouldShow: boolean,
              ) => {
                if (to <= from) {
                  return;
                }
                const isEditing = isEditable && shouldShow;
                decorationsToAdd.push(
                  Decoration.inline(
                    from,
                    to,
                    {
                      class: isEditing
                        ? MATH_DISPLAY_FENCE_CLASS
                        : `${MATH_DISPLAY_FENCE_CLASS} ${MATH_DISPLAY_FENCE_HIDDEN_CLASS}`,
                      style: isEditing ? undefined : HIDDEN_INLINE_STYLE,
                      "data-math-display-fence": "true",
                    },
                    {
                      content: "$$",
                      displayMode: true,
                      isEditable,
                      isEditing,
                      katexOptions,
                    } satisfies MathDecorationSpec,
                  ),
                );
              };

              newState.doc.nodesBetween(
                minFrom,
                maxTo,
                (node: any, pos: number) => {
                  if (
                    !node.isText ||
                    !node.text ||
                    !shouldRender(newState, pos, node)
                  ) {
                    return;
                  }

                  const detected = detectInlineMathMatches(node.text);
                  if (!detected.length) {
                    return;
                  }

                  for (const match of detected) {
                    const from = pos + match.from;
                    const to = pos + match.to;
                    addMathDecorations(
                      from,
                      to,
                      match.content,
                      match.displayMode,
                    );
                  }
                },
              );

              newState.doc.nodesBetween(
                minFrom,
                maxTo,
                (node: any, pos: number) => {
                  if (!node.isTextblock || !node.textContent) {
                    return;
                  }
                  if (!shouldRender(newState, pos + 1, node)) {
                    return;
                  }
                  const content = detectDisplayMathFromTextblock(
                    node.textContent,
                  );
                  if (!content) {
                    return;
                  }
                  const from = pos + 1;
                  const to = pos + node.nodeSize - 1;
                  addMathDecorations(from, to, content, true);
                },
              );

              newState.doc.nodesBetween(
                minFrom,
                maxTo,
                (node: any, pos: number) => {
                  if (!node.isTextblock || !node.textContent) {
                    return;
                  }
                  if (!shouldRender(newState, pos + 1, node)) {
                    return;
                  }
                  const trailingFence = detectDisplayMathWithTrailingFence(
                    node.textContent,
                  );
                  if (!trailingFence) {
                    return;
                  }

                  const resolved = newState.doc.resolve(pos + 1);
                  if (resolved.depth <= 0) {
                    return;
                  }
                  const parentDepth = resolved.depth - 1;
                  const parent = resolved.node(parentDepth);
                  const indexInParent = resolved.index(parentDepth);
                  if (indexInParent <= 0) {
                    return;
                  }
                  const previousSibling = parent.maybeChild(indexInParent - 1);
                  if (
                    !previousSibling?.isTextblock ||
                    !isDisplayFenceParagraph({
                      type: previousSibling.type,
                      textContent: previousSibling.textContent,
                    })
                  ) {
                    return;
                  }

                  const from = pos + 1;
                  const to = from + trailingFence.contentLength;
                  addMathDecorations(from, to, trailingFence.content, true);
                },
              );

              const topNodes: Array<{
                node: {
                  type?: { name?: string };
                  textContent: string;
                  nodeSize: number;
                  isTextblock?: boolean;
                };
                pos: number;
              }> = [];
              newState.doc.forEach((node, pos) => {
                topNodes.push({
                  node: node as {
                    type?: { name?: string };
                    textContent: string;
                    nodeSize: number;
                    isTextblock?: boolean;
                  },
                  pos,
                });
              });

              let index = 0;
              while (index < topNodes.length) {
                const openingFence = topNodes[index];
                if (
                  !openingFence ||
                  !isDisplayFenceParagraph(openingFence.node)
                ) {
                  index += 1;
                  continue;
                }

                let closingFenceIndex = -1;
                for (
                  let probe = index + 1;
                  probe < topNodes.length;
                  probe += 1
                ) {
                  const candidate = topNodes[probe];
                  if (candidate && isDisplayFenceParagraph(candidate.node)) {
                    closingFenceIndex = probe;
                    break;
                  }
                }
                if (closingFenceIndex === -1) {
                  index += 1;
                  continue;
                }
                const closingFence = topNodes[closingFenceIndex];
                if (!closingFence) {
                  index = closingFenceIndex + 1;
                  continue;
                }

                const openingFrom = openingFence.pos + 1;
                const openingTo =
                  openingFence.pos + openingFence.node.nodeSize - 1;
                const blockFrom = openingFrom;
                const blockTo =
                  closingFence.pos + closingFence.node.nodeSize - 1;
                const isEditingCurrentBlock =
                  isEditable &&
                  isSelectionInsideRange(selection, blockFrom, blockTo);
                if (rangesOverlap(openingFrom, openingTo, minFrom, maxTo)) {
                  addDisplayFenceDecoration(
                    openingFrom,
                    openingTo,
                    isEditingCurrentBlock,
                  );
                }

                const closingFrom = closingFence.pos + 1;
                const closingTo =
                  closingFence.pos + closingFence.node.nodeSize - 1;
                if (rangesOverlap(closingFrom, closingTo, minFrom, maxTo)) {
                  addDisplayFenceDecoration(
                    closingFrom,
                    closingTo,
                    isEditingCurrentBlock,
                  );
                }

                for (
                  let contentIndex = index + 1;
                  contentIndex < closingFenceIndex;
                  contentIndex += 1
                ) {
                  const current = topNodes[contentIndex];
                  if (!current || current.node.type?.name !== "paragraph") {
                    continue;
                  }
                  const from = current.pos + 1;
                  const to = current.pos + current.node.nodeSize - 1;
                  if (!rangesOverlap(from, to, minFrom, maxTo)) {
                    continue;
                  }
                  const content = current.node.textContent.trim();
                  addMathDecorations(from, to, content, true);
                }

                index = closingFenceIndex + 1;
              }

              return {
                decorations: nextDecorationSetWithoutAffected.add(
                  tr.doc,
                  decorationsToAdd,
                ),
                isEditable,
              };
            },
          },
          props: {
            decorations(state) {
              return this.getState(state)?.decorations ?? DecorationSet.empty;
            },
          },
          view(view) {
            const updatePreviewForSelection = () => {
              const activeAnchor = findActiveMathAnchor(
                view as { dom: HTMLElement },
              );
              if (
                !(activeAnchor instanceof HTMLElement) ||
                activeAnchor.classList.contains(MATH_EDITOR_HIDDEN_CLASS)
              ) {
                hideMathPreview();
                return;
              }
              showMathPreview(activeAnchor);
            };

            updatePreviewForSelection();
            return {
              update() {
                updatePreviewForSelection();
              },
              destroy() {
                hideMathPreview();
              },
            };
          },
        }),
      ];
    },
  });
