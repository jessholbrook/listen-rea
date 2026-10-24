export function withoutOptionImage<
  T extends { imageAssetId?: string | null; imageAlt?: string },
>(
  o: T,
): Omit<T, "imageAssetId" | "imageAlt"> & {
  imageAssetId?: undefined;
  imageAlt?: undefined;
} {
  const { imageAssetId, imageAlt, ...rest } = o;
  return rest;
}
