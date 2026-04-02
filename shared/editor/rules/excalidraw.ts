import type MarkdownIt from "markdown-it";

/**
 * A markdown-it plugin that transforms `fence` tokens with info string
 * "excalidraw" into `excalidraw` tokens so they are parsed as dedicated
 * Excalidraw nodes rather than generic code blocks.
 */
export default function excalidrawRule(md: MarkdownIt) {
  md.core.ruler.after("breaks", "excalidraw", (state) => {
    for (const token of state.tokens) {
      if (token.type === "fence" && token.info.trim() === "excalidraw") {
        token.type = "excalidraw";
      }
    }
  });
}
