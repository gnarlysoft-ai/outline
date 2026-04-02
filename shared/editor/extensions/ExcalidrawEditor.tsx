import { action, observable } from "mobx";
import { observer } from "mobx-react";
import type { Node } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { NodeSelection } from "prosemirror-state";
import * as React from "react";
import ExcalidrawEditorOverlay from "../components/ExcalidrawEditorOverlay";
import type { CommandFactory, WidgetProps } from "../lib/Extension";
import Extension from "../lib/Extension";
import type { NodeWithPos } from "../types";

interface ExcalidrawSession {
  nodeId: string;
  data: string;
}

/**
 * An editor extension that manages the lifecycle of the fullscreen Excalidraw
 * editor overlay. Provides the `editExcalidraw` command and renders the overlay
 * widget when a session is active.
 */
export default class ExcalidrawEditor extends Extension {
  get name() {
    return "excalidrawEditor";
  }

  @observable
  activeSession: ExcalidrawSession | null = null;

  commands(): Record<string, CommandFactory> {
    return {
      editExcalidraw: (): Command => (state, dispatch) => {
        if (!dispatch) {
          return true;
        }

        const selectedNode = this.getSelectedExcalidrawNode(state);
        if (!selectedNode) {
          return false;
        }

        this.openEditor(selectedNode);
        return true;
      },
    };
  }

  /**
   * Gets the currently selected excalidraw node if it exists.
   *
   * @param state - the editor state.
   * @returns the selected excalidraw node or undefined.
   */
  private getSelectedExcalidrawNode(
    state: EditorState
  ) {
    if (state.selection instanceof NodeSelection) {
      const node = state.selection.node;
      if (node.type.name === "excalidraw") {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Opens the fullscreen editor for a given excalidraw node.
   *
   * @param node - the excalidraw node to edit.
   */
  @action
  private openEditor(node: Node) {
    this.activeSession = {
      nodeId: node.attrs.id,
      data: node.attrs.data ?? "{}",
    };
  }

  /**
   * Saves the edited data back into the document node.
   *
   * @param data - the serialized JSON string from the Excalidraw editor.
   */
  @action
  private handleSave = (data: string) => {
    if (!this.activeSession) {
      return;
    }

    const { state } = this.editor.view;
    const { dispatch } = this.editor.view;
    const nodeId = this.activeSession.nodeId;

    const found = this.findExcalidrawNodeById(state, nodeId);
    if (found) {
      dispatch(
        state.tr.setNodeMarkup(found.pos, undefined, {
          ...found.node.attrs,
          data,
        })
      );
    }

    this.activeSession = null;
    this.editor.view.focus();
  };

  /**
   * Closes the editor without saving.
   */
  @action
  private handleClose = () => {
    this.activeSession = null;
    this.editor.view.focus();
  };

  /**
   * Finds an excalidraw node in the document by its id attribute.
   *
   * @param state - the editor state.
   * @param id - the node id to search for.
   * @returns the node and its position, or undefined.
   */
  private findExcalidrawNodeById(
    state: EditorState,
    id: string
  ): NodeWithPos | undefined {
    let foundNode: NodeWithPos | undefined;
    state.doc.descendants((node, pos) => {
      if (
        node.type.name === "excalidraw" &&
        node.attrs.id === id
      ) {
        foundNode = { node, pos };
        return false;
      }
      return true;
    });
    return foundNode;
  }

  widget = (_props: WidgetProps): React.ReactElement =>
    React.createElement(
      observer(() =>
        this.activeSession
          ? React.createElement(ExcalidrawEditorOverlay, {
              session: this.activeSession,
              onSave: this.handleSave,
              onClose: this.handleClose,
            })
          : null
      )
    );
}
