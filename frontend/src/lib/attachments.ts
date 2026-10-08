/** Attachments: images and PDFs. PDFs are rendered to page images in the browser, so the API only sees images. */

export const MAX_ATTACHMENTS = 5; // images + PDF pages, per message
export const ATTACH_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

const IMAGE_TYPES = /^image\/(png|jpe?g|webp)$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const PHOTO_SIDE = 1280;
const PAGE_SIDE = 1500; // PDF text needs more pixels than a photo to stay legible
const MAX_PAGE_B64 = 2_200_000; // per-page cap; beyond this a PNG is re-encoded as JPEG

export type Attachment = {
  id: string;
  mime: "image/jpeg" | "image/png";
  data: string; // base64, no data: prefix
  thumb: string; // small data URL for the tray and chat history
  label?: string; // "report.pdf · p.2" for PDF pages
  pdf?: boolean;
};

export type AddResult = {
  items: Attachment[];
  notices: string[]; // explanations of anything skipped or trimmed
};

const uid = () => Math.random().toString(36).slice(2, 10);

function draw(
  source: CanvasImageSource,
  w: number,
  h: number,
  maxSide: number,
  type: "image/png" | "image/jpeg",
  quality = 0.85,
) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that file.");
  ctx.fillStyle = "#fff"; // flatten transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

const b64 = (dataUrl: string) => dataUrl.split(",")[1];

async function fromImage(file: File): Promise<Attachment> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is too large (max 10 MB).`);
  const bmp = await createImageBitmap(file);
  try {
    return {
      id: uid(),
      mime: "image/jpeg", // re-encoding also drops EXIF/GPS data
      data: b64(draw(bmp, bmp.width, bmp.height, PHOTO_SIDE, "image/jpeg", 0.85)),
      thumb: draw(bmp, bmp.width, bmp.height, 220, "image/jpeg", 0.6),
      label: file.name,
    };
  } finally {
    bmp.close();
  }
}

async function fromPdf(file: File, room: number, notices: string[]): Promise<Attachment[]> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is too large (max 25 MB).`);
  const pdfjs = await import("pdfjs-dist"); // lazy: the ~1 MB renderer loads only for PDFs
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const locked = (e as { name?: string }).name === "PasswordException";
    throw new Error(locked ? `${file.name} is password-protected.` : `${file.name} couldn't be read as a PDF.`);
  }
  try {
    const take = Math.min(doc.numPages, room);
    if (doc.numPages > take) {
      notices.push(
        room < MAX_ATTACHMENTS
          ? `${file.name} has ${doc.numPages} pages - only the first ${take} fit in the ${MAX_ATTACHMENTS}-attachment limit.`
          : `${file.name} has ${doc.numPages} pages - attached the first ${take}.`,
      );
    }
    const out: Attachment[] = [];
    for (let n = 1; n <= take; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, PAGE_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not render the PDF.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      let mime: Attachment["mime"] = "image/png"; // lossless keeps small text crisp
      let data = b64(canvas.toDataURL("image/png"));
      if (data.length > MAX_PAGE_B64) {
        mime = "image/jpeg"; // dense page: JPEG to stay under the cap
        data = b64(canvas.toDataURL("image/jpeg", 0.85));
      }
      out.push({
        id: uid(),
        mime,
        data,
        thumb: draw(canvas, canvas.width, canvas.height, 220, "image/jpeg", 0.6),
        label: `${file.name} · p.${n}`,
        pdf: true,
      });
      page.cleanup();
    }
    return out;
  } finally {
    void task.destroy();
  }
}

/** Convert dropped/picked files into attachments, never exceeding `room` slots. */
export async function filesToAttachments(
  files: File[],
  room: number,
  onProgress?: (pending: number) => void,
): Promise<AddResult> {
  const items: Attachment[] = [];
  const notices: string[] = [];
  let left = room;
  let skipped = 0;

  for (const file of files) {
    if (left <= 0) {
      skipped++;
      continue;
    }
    try {
      onProgress?.(Math.min(left, file.type === "application/pdf" ? left : 1));
      if (file.type === "application/pdf") {
        const pages = await fromPdf(file, left, notices);
        items.push(...pages);
        left -= pages.length;
      } else if (IMAGE_TYPES.test(file.type)) {
        items.push(await fromImage(file));
        left -= 1;
      } else {
        notices.push(`${file.name || "That file"} isn't supported - attach PNG, JPG, WebP or PDF.`);
      }
    } catch (e) {
      notices.push((e as Error).message);
    }
  }
  onProgress?.(0);
  if (skipped > 0) {
    notices.unshift(
      `Attachment limit reached - up to ${MAX_ATTACHMENTS} images or PDF pages per message. ${skipped} file${skipped > 1 ? "s were" : " was"} skipped.`,
    );
  }
  return { items, notices };
}
