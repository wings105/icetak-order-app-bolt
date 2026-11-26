import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {loadAwbBlob} from './awb-pdf-print';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function printCombined(base:string, orderId:string, taskId:string, items:NodeListOf<HTMLElement>) {
 const blob = await loadAwbBlob(base, orderId, taskId);
 const pdf = getDocument({data:await blob.arrayBuffer(), isEvalSupported:false, useWasm:false});
 const canvas = document.createElement('canvas');
 try {
  const documentPdf = await pdf.promise;
  if (documentPdf.numPages !== 1) throw new Error('AWB ini mempunyai beberapa halaman. Gunakan Print AWB untuk cetak semua halaman.');
  const page = await documentPdf.getPage(1);
  const view = page.getViewport({scale:1});
  const landscape = view.width > view.height;
  const width = landscape ? 148 : 105;
  const height = landscape ? 105 : 148;
  const factor = Math.min(width / view.width, height / view.height);
  const viewport = page.getViewport({scale:factor * 300 / 25.4});
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = view.width * factor + 'mm';
  canvas.style.height = view.height * factor + 'mm';
  await page.render({canvas,viewport}).promise;
 } finally {
  await pdf.destroy();
 }

 const sheet = document.createElement('article');
 sheet.className = 'awb-combined-sheet';
 const heading = document.createElement('strong');
 heading.textContent = 'Reference Order · ' + orderId;
 const grid = document.createElement('div');
 grid.className = 'awb-combined-grid';
 const columns = Math.ceil(Math.sqrt(items.length * 1.5));
 grid.style.gridTemplateColumns = `repeat(${Math.min(columns,items.length)},minmax(0,1fr))`;
 grid.style.gridTemplateRows = `repeat(${Math.ceil(items.length/columns)},minmax(0,1fr))`;
 for (const item of items) {
  const copy = item.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.awb-task-action-area,button').forEach(control=>control.remove());
  grid.append(copy);
 }
 sheet.append(canvas,heading,grid);
 document.body.append(sheet);
 try {
  await Promise.all(Array.from(grid.querySelectorAll('img'),img=>img.decode()));
  // Measure the actual print layout before opening the dialog, including long names.
  for (const item of grid.children) {
   const images = item.querySelector('.awb-images')!;
   if (images.clientHeight < 12 || item.scrollHeight > item.clientHeight + 1 || grid.scrollHeight > grid.clientHeight + 1)
    throw new Error('Reference terlalu padat untuk satu A4. Gunakan Print gambar order.');
  }
  document.body.classList.add('awb-combined-print');
  window.print();
 } finally {
  document.body.classList.remove('awb-combined-print');
  sheet.remove();
 }
}
