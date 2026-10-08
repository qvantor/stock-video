import type { SpriteMeta } from '@dfs/contracts';

interface Props {
  spriteUrl: string;
  meta: SpriteMeta;
  /** Thumbnail index in the sheet. */
  index?: number;
  /** Rendered width in px; height follows the tile aspect ratio. */
  width: number;
  /** Fixed height in px: the frame then covers the width × height box, cropped and centred. */
  height?: number;
  className?: string;
}

/** One frame from the sprite sheet, scaled via background-size. */
export const SpriteThumb = ({ spriteUrl, meta, index = 0, width, height, className }: Props) => {
  const scale =
    height === undefined
      ? width / meta.tileWidth
      : Math.max(width / meta.tileWidth, height / meta.tileHeight);
  const boxHeight = height ?? meta.tileHeight * scale;
  // Centre the scaled frame inside the box (zero offset when it fits exactly).
  const dx = (width - meta.tileWidth * scale) / 2;
  const dy = (boxHeight - meta.tileHeight * scale) / 2;
  const i = Math.max(0, Math.min(meta.count - 1, index));
  const col = i % meta.columns;
  const row = Math.floor(i / meta.columns);
  return (
    <div
      className={className}
      style={{
        width,
        height: boxHeight,
        backgroundImage: `url(${spriteUrl})`,
        backgroundSize: `${meta.columns * meta.tileWidth * scale}px ${meta.rows * meta.tileHeight * scale}px`,
        backgroundPosition: `${dx - col * meta.tileWidth * scale}px ${dy - row * meta.tileHeight * scale}px`,
      }}
    />
  );
};
