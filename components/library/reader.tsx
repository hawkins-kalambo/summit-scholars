"use client";
/* eslint-disable @next/next/no-img-element -- Private image requests must carry the browser session directly; an image optimizer must not cache or fetch these files. */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
export function LibraryReader({ id, mime, text, watermark }: { id: string; mime: string | null; text: string | null; watermark: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [pageText, setPageText] = useState("");
  const url = "/portal/library/" + id + "/content";
  useEffect(() => {
    if (mime !== "application/pdf") return;
    let stopped = false; let task: { destroy: () => Promise<void> } | undefined;
    void (async () => {
      try {
        const pdf = await import("pdfjs-dist");
        pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        if (stopped) return;
        const loading = pdf.getDocument({ url, disableAutoFetch: true, disableStream: true }); task = loading;
        const result = await loading.promise; if (!stopped) setDocument(result);
      } catch { if (!stopped) setError("This document could not be opened. Your access may have changed, or the file may be invalid. Reload to try again."); }
    })();
    return () => { stopped = true; void task?.destroy(); };
  }, [mime,url]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let stopped = false; let render: RenderTask | undefined;
    void (async () => {
      setBusy(true);
      try {
        const pdfPage = await document.getPage(page); if (stopped || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: 1.4 });
        const element = canvas.current; element.width = viewport.width; element.height = viewport.height;
        render = pdfPage.render({ canvas: element, viewport }); await render.promise;
        const content = await pdfPage.getTextContent();
        if (!stopped) setPageText(content.items.map(item => "str" in item ? item.str : "").join(" "));
      } catch { if (!stopped) setError("This page could not be rendered. Try reloading the material."); }
      finally { if (!stopped) setBusy(false); }
    })();
    return () => { stopped = true; render?.cancel(); };
  }, [document,page]);
  return <section className="library-reader" aria-label="Study material reader">
    <p className="reader-watermark">For portal study ? {watermark}</p>
    {error && <p role="alert">{error}</p>}
    {text !== null ? <article className="library-notes">{text}</article> : mime === "application/pdf" ? <>
      <div className="reader-toolbar"><button className="btn outline-dark" disabled={!document || page===1 || busy} onClick={() => setPage(p=>p-1)}>Previous page</button><span aria-live="polite">{document ? "Page " + page + " of " + document.numPages : "Loading document..."}</span><button className="btn outline-dark" disabled={!document || page===document.numPages || busy} onClick={() => setPage(p=>p+1)}>Next page</button></div>
      <div className="reader-sheet"><canvas ref={canvas} aria-label={"Document page " + page}/><span className="sheet-watermark" aria-hidden="true">{watermark}</span></div>
      {pageText && <details><summary>Read page as accessible text</summary><p className="library-notes">{pageText}</p></details>}
    </> : <div className="reader-sheet">{/* Authenticated endpoint, not a public image URL. */}<img src={url} alt="Uploaded study material" onError={() => setError("This image could not be loaded. Reload to check your access.")}/><span className="sheet-watermark" aria-hidden="true">{watermark}</span></div>}
  </section>;
}
