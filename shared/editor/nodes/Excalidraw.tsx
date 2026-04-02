import type { Token } from "markdown-it";
import type {
  NodeSpec,
  NodeType,
  Node as ProsemirrorNode,
} from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { NodeSelection } from "prosemirror-state";
import * as React from "react";
import { v4 as uuidv4 } from "uuid";
import ExcalidrawNodeView from "../components/ExcalidrawNodeView";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import excalidrawRule from "../rules/excalidraw";
import type { ComponentProps } from "../types";
import Node from "./Node";

/**
 * A ProseMirror node that stores Excalidraw diagram data inline as JSON.
 * Serializes to/from a fenced code block with language "excalidraw".
 */
export default class Excalidraw extends Node {
  get name() {
    return "excalidraw";
  }

  get rulePlugins() {
    return [excalidrawRule];
  }

  get markdownToken() {
    return "excalidraw";
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        id: {
          default: null,
        },
        data: {
          default: "{}",
        },
        width: {
          default: null,
        },
        height: {
          default: null,
        },
      },
      group: "block",
      selectable: true,
      draggable: false,
      defining: true,
      atom: true,
      parseDOM: [
        {
          priority: 100,
          tag: "div.excalidraw-node",
          getAttrs: (dom: HTMLDivElement) => ({
            id: dom.id,
            data: dom.dataset.excalidraw ?? "{}",
            width: dom.dataset.width
              ? parseInt(dom.dataset.width, 10)
              : null,
            height: dom.dataset.height
              ? parseInt(dom.dataset.height, 10)
              : null,
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "excalidraw-node",
          id: node.attrs.id,
          "data-excalidraw": node.attrs.data,
          "data-width": node.attrs.width,
          "data-height": node.attrs.height,
        },
        "Excalidraw diagram",
      ],
      leafText: () => "Excalidraw diagram",
    };
  }

  handleChangeSize =
    ({ node, getPos }: { node: ProsemirrorNode; getPos: () => number }) =>
    ({ width, height }: { width: number; height?: number }) => {
      const { view } = this.editor;
      const { tr } = view.state;

      const pos = getPos();
      const transaction = tr
        .setNodeMarkup(pos, undefined, {
          ...node.attrs,
          width,
          height,
        })
        .setMeta("addToHistory", true);
      const $pos = transaction.doc.resolve(pos);
      view.dispatch(transaction.setSelection(new NodeSelection($pos)));
    };

  handleEdit =
    ({ getPos }: { getPos: () => number }) =>
    () => {
      const { view } = this.editor;
      const $pos = view.state.doc.resolve(getPos());
      view.dispatch(view.state.tr.setSelection(new NodeSelection($pos)));
      this.editor.commands.editExcalidraw?.();
    };

  component = (props: ComponentProps) => (
    <ExcalidrawNodeView
      {...props}
      onEdit={this.handleEdit(props)}
      onChangeSize={props.isEditable ? this.handleChangeSize(props) : undefined}
    />
  );

  commands({ type }: { type: NodeType }) {
    return {
      createExcalidraw: (): Command => (state, dispatch) => {
        if (dispatch) {
          const node = type.create({
            id: uuidv4(),
            data: "{}",
          });
          const tr = state.tr.replaceSelectionWith(node).scrollIntoView();
          dispatch(tr);

          // Open the editor after a tick so the node is in the DOM
          setTimeout(() => {
            this.editor.commands.editExcalidraw?.();
          }, 0);
        }
        return true;
      },
      deleteExcalidraw: (): Command => (state, dispatch) => {
        if (
          state.selection instanceof NodeSelection &&
          state.selection.node.type === type
        ) {
          dispatch?.(state.tr.deleteSelection());
          return true;
        }
        return false;
      },
      resizeExcalidraw:
        (attrs?: Record<string, unknown>): Command =>
        (state, dispatch) => {
          if (
            state.selection instanceof NodeSelection &&
            state.selection.node.type === type
          ) {
            const { node } = state.selection;
            dispatch?.(
              state.tr.setNodeMarkup(state.selection.from, undefined, {
                ...node.attrs,
                ...attrs,
              })
            );
            return true;
          }
          return false;
        },
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.write("```excalidraw\n");
    state.text(node.attrs.data || "{}", false);
    state.ensureNewLine();
    state.write("```");
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      node: "excalidraw",
      noCloseToken: true,
      getAttrs: (tok: Token) => {
        const raw = tok.content?.trim() || "{}";
        try {
          JSON.parse(raw);
        } catch {
          return { id: uuidv4(), data: "{}" };
        }
        return { id: uuidv4(), data: raw };
      },
    };
  }
}
