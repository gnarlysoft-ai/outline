import "@excalidraw/excalidraw/index.css";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled, { useTheme } from "styled-components";
import { depths, s } from "../../styles";

const LazyExcalidraw = React.lazy(() =>
  import("@excalidraw/excalidraw").then((mod) => ({
    default: mod.Excalidraw,
  }))
);

interface ExcalidrawSession {
  /** Stable node ID for finding the node after save. */
  nodeId: string;
  /** JSON string of the excalidraw data. */
  data: string;
}

interface Props {
  /** The active editing session. */
  session: ExcalidrawSession;
  /** Called with the new JSON string when the user saves. */
  onSave: (data: string) => void;
  /** Called when the user closes without saving. */
  onClose: () => void;
}

/**
 * Fullscreen overlay containing the Excalidraw editor. Lazy-loads the
 * @excalidraw/excalidraw React component on first render.
 */
export default function ExcalidrawEditorOverlay({
  session,
  onSave,
  onClose,
}: Props) {
  const theme = useTheme();
  const excalidrawAPIRef = useRef<ExcalidrawAPI | null>(null);

  const initialData = useMemo(() => {
    try {
      const parsed = JSON.parse(session.data || "{}");
      return {
        elements: parsed.elements || [],
        appState: {
          ...parsed.appState,
          theme: theme.isDark ? ("dark" as const) : ("light" as const),
        },
        files: parsed.files || undefined,
        scrollToContent: true,
      };
    } catch {
      return {
        elements: [],
        appState: {
          theme: theme.isDark ? ("dark" as const) : ("light" as const),
        },
        scrollToContent: true,
      };
    }
  }, [session.data, theme.isDark]);

  const handleSave = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) {
      return;
    }

    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();

    const data = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements,
      appState: {
        gridSize: appState.gridSize,
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files: files && Object.keys(files).length > 0 ? files : undefined,
    });

    onSave(data);
  }, [onSave]);

  const hasUnsavedChanges = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) {
      return false;
    }
    const currentElements = api.getSceneElements();
    const initialElements = initialData.elements;
    return currentElements.length !== initialElements.length ||
      JSON.stringify(currentElements) !== JSON.stringify(initialElements);
  }, [initialData.elements]);

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges()) {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm("You have unsaved changes. Close anyway?")) {
        return;
      }
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }
      // Ctrl/Cmd+S to save
      if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        handleSave();
      }
    },
    [handleClose, handleSave]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleKeyDown]);

  // Prevent body scroll while editor is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <Overlay>
      <Toolbar>
        <ToolbarTitle>Excalidraw</ToolbarTitle>
        <ToolbarActions>
          <ToolbarButton onClick={handleSave} $primary>
            Save
          </ToolbarButton>
          <ToolbarButton onClick={handleClose}>Close</ToolbarButton>
        </ToolbarActions>
      </Toolbar>
      <EditorContainer>
        <Suspense fallback={<Loading>Loading Excalidraw editor...</Loading>}>
          <LazyExcalidraw
            excalidrawAPI={(api: ExcalidrawAPI) => {
              excalidrawAPIRef.current = api;
            }}
            initialData={initialData}
            theme={theme.isDark ? "dark" : "light"}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
              },
            }}
          />
        </Suspense>
      </EditorContainer>
    </Overlay>
  );
}

/** Minimal type for the imperative API handle. */
interface ExcalidrawAPI {
  getSceneElements: () => readonly Record<string, unknown>[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${depths.modal};
  background: ${s("background")};
  display: flex;
  flex-direction: column;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid ${s("divider")};
  background: ${s("background")};
  z-index: 1;
  flex-shrink: 0;
`;

const ToolbarTitle = styled.span`
  font-weight: 600;
  font-size: 14px;
  color: ${s("text")};
`;

const ToolbarActions = styled.div`
  display: flex;
  gap: 8px;
`;

const ToolbarButton = styled.button<{ $primary?: boolean }>`
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid ${(props) => (props.$primary ? "transparent" : s("divider"))};
  background: ${(props) => (props.$primary ? s("accent") : s("background"))};
  color: ${(props) => (props.$primary ? "white" : s("text"))};

  &:hover {
    opacity: 0.9;
  }
`;

const EditorContainer = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;

  .excalidraw {
    height: 100%;
  }
`;

const Loading = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${s("textTertiary")};
  font-size: 14px;
`;
