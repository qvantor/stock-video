/** Marketing resolution label from frame size (long side). */
export const resolutionLabel = (width: number, height: number): string => {
  const long = Math.max(width, height);
  if (long >= 7680) return '8K';
  if (long >= 5120) return '5K';
  if (long >= 3840) return '4K';
  if (long >= 2688) return '2.7K';
  if (long >= 1280) return 'HD';
  return 'SD';
};
