import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
export async function scannedPDF() {
  const doc = await PDFDocument.create();
  const first = doc.addPage([600, 400]);
  first.drawText("Selectable reference page", { x: 40, y: 300, size: 20 });
  const canvas = createCanvas(1200, 800),
    context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1200, 800);
  context.fillStyle = "black";
  context.font = "40px sans-serif";
  context.fillText("Synthetic scanned research page", 70, 160);
  context.fillText("Save draft before review.", 70, 250);
  const image = await doc.embedPng(canvas.toBuffer("image/png"));
  doc
    .addPage([600, 400])
    .drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
  return Buffer.from(await doc.save());
}
