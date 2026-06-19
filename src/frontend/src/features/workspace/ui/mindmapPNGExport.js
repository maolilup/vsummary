// src/frontend/src/features/workspace/ui/mindmapPNGExport.js
import * as d3 from "d3";

const EXPORT_PADDING = 60;

/**
 * Export the full markmap as a PNG, sized to the natural content bounds
 * (not the user's current pan/zoom). Strategy:
 *
 *   1. Save the live d3-zoom transform from the SVG node's `__zoom` property.
 *   2. Clone the live SVG. The clone is mutated, the live SVG is not.
 *   3. On the clone: set `width` / `height` / `viewBox` to
 *      `state.rect + 60px padding` so the entire content renders at 1:1.
 *   4. On the clone: remove the `transform` attribute on the inner <g> so the
 *      content is positioned in the new viewBox, not by the user's pan/zoom.
 *   5. Serialize the clone, rasterize onto an off-screen 2x canvas, trigger
 *      a download via a temporary <a download> click.
 *   6. Restore the live SVG's d3-zoom transform in `finally` (defensive — the
 *      live SVG was never mutated, so this is a no-op safety net in case a
 *      future change accidentally writes to the live node).
 *
 * The user's pan/zoom is preserved: the live SVG's `__zoom` is restored to
 * the same value it had at the start, even on error.
 *
 * Why not `mm.fit()` then serialize the live SVG? Because fitting to viewport
 * produces an export scaled to the viewport size, so a 200-node mindmap in a
 * 800x600 viewport yields 1600x1200 pixels of pixel-shared space — each node
 * becomes ~6-8px tall and the text is unreadable. Exporting at natural size
 * produces a PNG whose pixel dimensions are `(contentWidth + padding*2) * 2`,
 * keeping every node at a usable size regardless of viewport.
 *
 * @param {object} mm        Markmap instance from `Markmap.create(...)`.
 * @param {string} filename  Download filename, including the `.png` extension.
 * @returns {Promise<void>}  Resolves once the download has been triggered.
 */
export async function exportMindmapAsPNG(mm, filename) {
  if (!mm || typeof mm.svg !== "object") {
    throw new Error("exportMindmapAsPNG: a markmap instance is required");
  }

  const svgNode = mm.svg.node();
  if (!svgNode) {
    throw new Error("exportMindmapAsPNG: markmap has no SVG node attached");
  }

  // d3-zoom stores the live transform on the SVG node's `__zoom` property.
  const originalTransform = d3.zoomTransform(svgNode);

  try {
    const { x1, x2, y1, y2 } = mm.state.rect;
    const contentWidth = x2 - x1;
    const contentHeight = y2 - y1;
    if (contentWidth <= 0 || contentHeight <= 0) {
      throw new Error(
        "exportMindmapAsPNG: markmap state.rect is empty — wait for the first render",
      );
    }

    const paddedWidth = contentWidth + EXPORT_PADDING * 2;
    const paddedHeight = contentHeight + EXPORT_PADDING * 2;

    // Clone the live SVG so the user's view is not modified by the export.
    const clone = svgNode.cloneNode(true);
    clone.setAttribute("width", String(paddedWidth));
    clone.setAttribute("height", String(paddedHeight));
    clone.setAttribute(
      "viewBox",
      `${x1 - EXPORT_PADDING} ${y1 - EXPORT_PADDING} ${paddedWidth} ${paddedHeight}`,
    );
    // Remove d3-zoom's transform on the inner <g> so the content renders at
    // 1:1 in the new viewBox, not at the user's current pan/zoom.
    const innerG = clone.querySelector("g");
    if (innerG) innerG.removeAttribute("transform");

    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      await rasterizeSvgToPng(paddedWidth, paddedHeight, url, filename);
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    // Restore the user's view. The live SVG was never mutated in this design,
    // so this is a defensive no-op for now; it guards against future changes
    // that might accidentally write to the live node.
    try {
      mm.svg.call(mm.zoom.transform, originalTransform);
    } catch {
      // Swallow restoration errors: the export itself has already failed
      // and surfacing a second error would mask the original cause.
    }
  }
}

function rasterizeSvgToPng(width, height, svgUrl, filename) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        ctx.scale(2, 2);

        const bg = getComputedStyle(document.documentElement)
          .getPropertyValue("--color-bg")
          .trim() || "#ffffff";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const a = document.createElement("a");
        a.download = filename;
        a.href = canvas.toDataURL("image/png");
        a.click();

        resolve();
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("exportMindmapAsPNG: failed to load SVG into <img>"));
    img.src = svgUrl;
  });
}
