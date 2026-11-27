// One configured copy of PDF.js for the reader and the bookshelf covers.
// The legacy build polyfills recent JavaScript features, so it works in browsers that are a few versions old.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default pdfjs;
