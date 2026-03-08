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
const MATH_PREVIEW_CLASS = "Tiptap-math-hover-preview";
const MATH_PREVIEW_ERROR_CLASS = "Tiptap-math-hover-preview--error";

type ActiveMathPreview = {
  anchor: HTMLElement;
  element: HTMLDivElement;
};

function detectMathMatches(text: string): MathMatch[] {
  if (!text) {
    return [];
  }

  const displayMatched = text.match(DISPLAY_MATH_REGEX);
  if (displayMatched) {
    return [
      {
        from: 0,
        to: text.length,
        content: displayMatched[1]?.trim() || "",
        displayMode: true,
      },
    ].filter((item) => item.content.length > 0);
  }

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
              const { minFrom, maxTo } = getAffectedRange(
                newState,
                previousPluginState,
                isEditable,
                tr,
                state,
              );

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

                  const detected = detectMathMatches(node.text);
                  if (!detected.length) {
                    return;
                  }

                  for (const match of detected) {
                    const from = pos + match.from;
                    const to = pos + match.to;
                    const selectionSize = selection.from - selection.to;
                    const anchorIsInside =
                      selection.anchor >= from && selection.anchor <= to;
                    const rangeIsInside =
                      selection.from >= from && selection.to <= to;
                    const isEditing =
                      (selectionSize === 0 && anchorIsInside) || rangeIsInside;

                    if (
                      nextDecorationSet.find(
                        from,
                        to,
                        (spec: MathDecorationSpec) =>
                          spec.isEditing === isEditing &&
                          spec.content === match.content &&
                          spec.displayMode === match.displayMode &&
                          spec.isEditable === isEditable &&
                          spec.katexOptions === katexOptions,
                      ).length
                    ) {
                      continue;
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
                              ? "display:inline-block;height:0;opacity:0;overflow:hidden;position:absolute;width:0;"
                              : undefined,
                          "data-math-content": encodeURIComponent(
                            match.content,
                          ),
                          "data-math-display-mode": String(match.displayMode),
                          "data-math-active": String(isEditing && isEditable),
                        },
                        {
                          content: match.content,
                          displayMode: match.displayMode,
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
                            if (match.displayMode) {
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
                              katex.render(match.content, element, {
                                ...katexOptions,
                                displayMode: match.displayMode,
                                throwOnError: false,
                              });
                            } catch {
                              element.textContent = match.content;
                            }
                            return element;
                          },
                          {
                            content: match.content,
                            displayMode: match.displayMode,
                            isEditable,
                            isEditing,
                            katexOptions,
                          } satisfies MathDecorationSpec,
                        ),
                      );
                    }
                  }
                },
              );

              const decorationsToRemove = decorationsToAdd.flatMap((deco) =>
                nextDecorationSet.find(deco.from, deco.to),
              );

              return {
                decorations: nextDecorationSet
                  .remove(decorationsToRemove)
                  .add(tr.doc, decorationsToAdd),
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
              const activeAnchor = view.dom.querySelector(
                `.${MATH_EDITOR_CLASS}[data-math-active="true"]`,
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
