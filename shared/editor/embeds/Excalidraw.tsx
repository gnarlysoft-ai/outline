import * as React from "react";
import Frame from "../components/Frame";
import Image from "../components/Img";
import type { EmbedProps as Props } from ".";

/**
 * Renders an Excalidraw embed from a shared link URL.
 */
function Excalidraw({ matches, ...props }: Props) {
  const url = matches[0];

  return (
    <Frame
      {...props}
      src={url}
      icon={
        <Image
          src="/images/excalidraw.png"
          alt="Excalidraw"
          width={16}
          height={16}
        />
      }
      canonicalUrl={props.attrs.href}
      title="Excalidraw"
      border
    />
  );
}

export default Excalidraw;
