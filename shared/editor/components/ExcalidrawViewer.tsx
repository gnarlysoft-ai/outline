import React, { useCallback, useEffect, useRef, useState } from "react";
import styled, { useTheme } from "styled-components";
import Flex from "../../components/Flex";
import { s } from "../../styles";
import type { ComponentProps } from "../types";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import useDragResize from "./hooks/useDragResize";
import { ResizeLeft, ResizeRight } from "./ResizeHandle";
import { Preview, Subtitle, Title } from "./Widget";

type Props = ComponentProps & {
  /** Icon to display on the left side of the widget. */
  icon: React.ReactNode;
  /** Title of the widget. */
  title: React.ReactNode;
  /** Context, displayed to right of title. */
  context?: React.ReactNode;
  /** Callback triggered when the viewer is resized. */
  onChangeSize?: (props: { width: number; height?: number }) => void;
};

/**
 * Renders an uploaded `.excalidraw` JSON file as an inline SVG using
 * `@excalidraw/utils`. The SVG is re-rendered when the theme changes.
 */
export default function ExcalidrawViewer(props: Props) {
  const { node, isEditable, onChangeSize, isSelected } = props;
  const { href } = node.attrs;
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [svgContent, setSvgContent] = useState<string | null>(null);

  const { width, height, setSize, handlePointerDown, dragging } = useDragResize(
    {
      width: node.attrs.width,
      height: node.attrs.height,
      naturalWidth: 400,
      naturalHeight: 300,
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

  const renderSvg = useCallback(async () => {
    if (!href) {
      return;
    }

    try {
      setLoading(true);
      setError(false);

      const response = await fetch(href);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const json = await response.json();
      if (!json.elements || !Array.isArray(json.elements)) {
        throw new Error("Invalid excalidraw file format");
      }

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
      setSvgContent(svgElement.outerHTML);
    } catch (err) {
      // oxlint-disable-next-line no-console
      console.error("Failed to render excalidraw file:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [href, theme.isDark]);

  useEffect(() => {
    void renderSvg();
  }, [renderSvg]);

  if (error) {
    return null;
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
    >
      <Flex gap={6} align="center">
        {props.icon}
        <Preview>
          <Title>{props.title}</Title>
          <Subtitle>{props.context}</Subtitle>
        </Preview>
      </Flex>
      <SvgContainer
        style={{
          width: width ? width - 24 : "100%",
          height,
          pointerEvents:
            !isEditable || (isSelected && !dragging) ? "initial" : "none",
          marginTop: 6,
        }}
      >
        {loading && <LoadingPlaceholder>Loading…</LoadingPlaceholder>}
        {svgContent && (
          <div dangerouslySetInnerHTML={{ __html: svgContent }} />
        )}
      </SvgContainer>
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

const LoadingPlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: ${s("textTertiary")};
  font-size: 14px;
`;
