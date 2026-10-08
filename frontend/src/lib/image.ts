/** Crop to a centred square and re-encode until the data URL fits the API's 100 KB avatar limit. */
export async function imageToAvatar(file: File, maxBytes = 90 * 1024): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(file.type))
    throw new Error("Please choose a PNG, JPEG or WebP image.");
  if (file.size > 12 * 1024 * 1024) throw new Error("That image is too large (max 12 MB).");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read.");
  });
  try {
    for (const size of [256, 192, 128, 96]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser can't process images.");
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
      for (const [type, q] of [
        ["image/webp", 0.86],
        ["image/jpeg", 0.85],
        ["image/jpeg", 0.7],
      ] as const) {
        const url = canvas.toDataURL(type, q);
        if (!url.startsWith(`data:${type}`)) continue; // unsupported encoder
        const bytes = ((url.length - url.indexOf(",") - 1) * 3) / 4;
        if (bytes <= maxBytes) return url;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Couldn't make that image small enough - try a simpler picture.");
}
