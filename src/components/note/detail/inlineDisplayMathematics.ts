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
                              ? "Tiptap-mathematics-editor"
                              : "Tiptap-mathematics-editor Tiptap-mathematics-editor--hidden",
                          style:
                            !isEditing || !isEditable
                              ? "display:inline-block;height:0;opacity:0;overflow:hidden;position:absolute;width:0;"
                              : undefined,
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
        }),
      ];
    },
  });
