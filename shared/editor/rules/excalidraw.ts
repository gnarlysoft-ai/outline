import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

/**
 * A markdown-it block rule that parses `:::excalidraw` container directives
 * with raw (unparsed) content, similar to how fences work. This avoids the
 * markdown parser escaping JSON characters inside the block.
 *
 * Also includes a legacy fallback that converts ```excalidraw fences to
 * excalidraw tokens for backward compatibility.
 */
export default function excalidrawRule(md: MarkdownIt) {
  // Primary rule: :::excalidraw container directive with raw content
  md.block.ruler.before(
    "fence",
    "excalidraw_container",
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];

      // Must not be indented more than 3 spaces
      if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }

      // Check for opening :::excalidraw
      const lineText = state.src.slice(pos, max);
      if (!lineText.startsWith(":::excalidraw")) {
        return false;
      }

      // Extract optional metadata after :::excalidraw
      const info = lineText.slice(":::excalidraw".length).trim();

      // In validation mode, just confirm we matched
      if (silent) {
        return true;
      }

      // Scan for closing :::
      let nextLine = startLine;
      let haveEndMarker = false;

      for (;;) {
        nextLine++;
        if (nextLine >= endLine) {
          break;
        }

        const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];
        const closingLine = state.src.slice(linePos, lineMax).trim();

        if (closingLine === ":::") {
          haveEndMarker = true;
          break;
        }
      }

      // Capture raw content between opening and closing markers
      state.line = nextLine + (haveEndMarker ? 1 : 0);

      const token = state.push("excalidraw", "", 0);
      token.info = info;
      token.content = state.getLines(
        startLine + 1,
        nextLine,
        state.sCount[startLine],
        true
      );
      token.markup = ":::excalidraw";
      token.map = [startLine, state.line];

      return true;
    }
  );

  // Legacy fallback: convert ```excalidraw fences for backward compatibility
  md.core.ruler.after("breaks", "excalidraw_fence_legacy", (state) => {
    for (const token of state.tokens) {
      if (
        token.type === "fence" &&
        token.info.trim().startsWith("excalidraw")
      ) {
        token.type = "excalidraw";
      }
    }
  });
}
