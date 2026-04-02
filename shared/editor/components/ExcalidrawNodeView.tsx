import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditIcon } from "outline-icons";
import styled, { useTheme } from "styled-components";
import { s } from "../../styles";
import type { ComponentProps } from "../types";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import useDragResize from "./hooks/useDragResize";
import { ResizeLeft, ResizeRight } from "./ResizeHandle";

type Props = ComponentProps & {
  /** Callback to open the fullscreen Excalidraw editor. */
  onEdit: () => void;
  /** Callback triggered when the viewer is resized. */
  onChangeSize?: (props: { width: number; height?: number }) => void;
};

/**
 * Renders an Excalidraw diagram inline as an SVG preview with edit and
 * resize capabilities. When the data is empty, shows a placeholder.
 */
export default function ExcalidrawNodeView(props: Props) {
  const { node, isEditable, onChangeSize, onEdit, isSelected } = props;
  const { data } = node.attrs;
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const { width, height, setSize, handlePointerDown, dragging } = useDragResize(
    {
      width: node.attrs.width,
      height: node.attrs.height,
      naturalWidth: 600,
      naturalHeight: 400,
      gridSnap: 5,
      onChangeSize,
      ref: containerRef,
    }
  );

  useEffect(() => {
    if (node.attrs.width && node.attrs.width !== width) {
      setSize({
        width: node.attrs.width,
        height: node.attrs.height,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.width]);

  const hasData = useMemo(() => {
    try {
      const parsed = JSON.parse(data || "{}");
      return (
        parsed.elements && Array.isArray(parsed.elements) && parsed.elements.length > 0
      );
    } catch {
      return false;
    }
  }, [data]);

  const renderSvg = useCallback(async () => {
    if (!hasData) {
      setSvgContent(null);
      return;
    }

    try {
      setLoading(true);
      setError(false);

      const json = JSON.parse(data);
      const { exportToSvg } = await import("@excalidraw/utils");
      const svgElement = await exportToSvg({
        elements: json.elements,
        appState: {
          ...json.appState,
          theme: theme.isDark ? "dark" : "light",
          exportBackground: true,
        },
        files: json.files ?? null,
      });

      svgElement.style.width = "100%";
      svgElement.style.height = "100%";

      // Sanitize: strip scripts and event handlers from SVG output
      svgElement.querySelectorAll("script").forEach((el) => el.remove());
      for (const el of svgElement.querySelectorAll("*")) {
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith("on")) {
            el.removeAttribute(attr.name);
          }
        }
      }

      setSvgContent(svgElement.outerHTML);
    } catch (err) {
      // oxlint-disable-next-line no-console
      console.error("Failed to render excalidraw:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [data, hasData, theme.isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void renderSvg();
  }, [renderSvg]);

  const handleDoubleClick = useCallback(() => {
    if (isEditable) {
      onEdit();
    }
  }, [isEditable, onEdit]);

  // Empty placeholder state
  if (!hasData && !loading) {
    return (
      <Placeholder
        contentEditable={false}
        onClick={isEditable ? onEdit : undefined}
        onKeyDown={isEditable ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEdit();
          }
        } : undefined}
        role={isEditable ? "button" : undefined}
        tabIndex={isEditable ? 0 : undefined}
        $isEditable={isEditable}
        className={isSelected ? "ProseMirror-selectednode" : undefined}
      >
        <PlaceholderText>
          {isEditable ? "Click to create an Excalidraw diagram" : "Empty Excalidraw diagram"}
        </PlaceholderText>
      </Placeholder>
    );
  }

  if (error) {
    return (
      <Placeholder
        contentEditable={false}
        className={isSelected ? "ProseMirror-selectednode" : undefined}
      >
        <PlaceholderText>Failed to render diagram</PlaceholderText>
      </Placeholder>
    );
  }

  return (
    <ExcalidrawWrapper
      contentEditable={false}
      ref={containerRef}
      className={
        isSelected || dragging
          ? "excalidraw-wrapper ProseMirror-selectednode"
          : "excalidraw-wrapper"
      }
      style={{ width: width ?? "auto" }}
      $dragging={dragging}
      onDoubleClick={handleDoubleClick}
    >
      <SvgContainer
        style={{
          width: width ? width - 24 : "100%",
          height,
          pointerEvents:
            !isEditable || (isSelected && !dragging) ? "initial" : "none",
        }}
      >
        {loading && <LoadingPlaceholder>Loading...</LoadingPlaceholder>}
        {svgContent && (
          <div dangerouslySetInnerHTML={{ __html: svgContent }} />
        )}
      </SvgContainer>
      {isEditable && (
        <EditButton
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          $visible={isSelected}
          title="Edit diagram"
        >
          <EditIcon size={16} />
        </EditButton>
      )}
      {isEditable && !!onChangeSize && (
        <>
          <ResizeLeft
            onPointerDown={handlePointerDown("left")}
            $dragging={isSelected || dragging}
          />
          <ResizeRight
            onPointerDown={handlePointerDown("right")}
            $dragging={isSelected || dragging}
          />
        </>
      )}
    </ExcalidrawWrapper>
  );
}

const ExcalidrawWrapper = styled.div<{ $dragging: boolean }>`
  line-height: 0;
  position: relative;
  margin-left: auto;
  margin-right: auto;
  max-width: 100%;
  transition-property: width, height;
  transition-duration: 120ms;
  transition-timing-function: ease-in-out;
  overflow: hidden;
  will-change: ${(props) => (props.$dragging ? "width, height" : "auto")};
  box-shadow: 0 0 0 1px ${s("divider")};
  border-radius: ${EditorStyleHelper.blockRadius};
  padding: ${EditorStyleHelper.blockRadius};

  &:hover {
    ${ResizeLeft}, ${ResizeRight} {
      opacity: 1;
    }
  }
`;

const SvgContainer = styled.div`
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    max-width: 100%;
    max-height: 100%;
  }
`;

const EditButton = styled.button<{ $visible: boolean }>`
  position: absolute;
  top: 8px;
  right: 8px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  transition: opacity 150ms ease-in-out;
  color: ${s("textSecondary")};
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  z-index: 1;

  &:hover {
    background: ${s("sidebarBackground")};
    color: ${s("text")};
  }

  ${ExcalidrawWrapper}:hover & {
    opacity: 1;
  }
`;

const Placeholder = styled.div<{ $isEditable?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border: 2px dashed ${s("divider")};
  border-radius: ${EditorStyleHelper.blockRadius};
  cursor: ${(props) => (props.$isEditable ? "pointer" : "default")};
  user-select: none;

  &:hover {
    border-color: ${(props) => (props.$isEditable ? s("textTertiary") : s("divider"))};
  }
`;

const PlaceholderText = styled.span`
  color: ${s("textTertiary")};
  font-size: 14px;
`;

const LoadingPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: ${s("textTertiary")};
  font-size: 14px;
`;
