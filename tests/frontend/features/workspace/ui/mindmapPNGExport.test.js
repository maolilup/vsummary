// tests/frontend/features/workspace/ui/mindmapPNGExport.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { exportMindmapAsPNG } from "@src/features/workspace/ui/mindmapPNGExport";

function makeMarkmapMock({
  currentTransform = { k: 1, x: 0, y: 0 },
  contentRect = { x1: 0, x2: 2000, y1: 0, y2: 1500 },
} = {}) {
  // Real jsdom SVG so cloneNode / setAttribute / getAttribute work as in the browser.
  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgNode.setAttribute("class", "mindmap-svg");
  // d3-zoom stores the transform on the SVG node's __zoom property.
  Object.defineProperty(svgNode, "__zoom", {
    value: currentTransform,
    writable: true,
    configurable: true,
  });

  const transformCalls = [];
  const call = vi.fn((sel, transform) => {
    transformCalls.push(transform);
    if (transform && typeof transform === "object" && "k" in transform) {
      Object.defineProperty(svgNode, "__zoom", { value: transform, writable: true, configurable: true });
    }
    return sel;
  });

  const fit = vi.fn(() => Promise.resolve());
  const mm = {
    fit,
    svg: { node: vi.fn(() => svgNode), call },
    zoom: { transform: "TRANSFORM_OP" }, // sentinel; d3-zoom.transform is a function, but the mock only
                                         // uses it as a tag inside `mm.svg.call(mm.zoom.transform, t)`.
    state: { rect: contentRect },
  };
  return { mm, svgNode, fit, call, transformCalls };
}

function installFakeImage() {
  const original = globalThis.Image;
  class FakeImage {
    constructor() { this.onload = null; this.onerror = null; }
    set src(v) {
      this._src = v;
      Promise.resolve().then(() => this.onload && this.onload());
    }
    get src() { return this._src || ""; }
  }
  globalThis.Image = FakeImage;
  return () => { globalThis.Image = original; };
}

describe("exportMindmapAsPNG", () => {
  beforeEach(() => {
    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
      globalThis.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T1: does not call mm.fit()", async () => {
    const { mm, fit } = makeMarkmapMock();
    const restoreImage = installFakeImage();

    await exportMindmapAsPNG(mm, "test.png");

    expect(fit).not.toHaveBeenCalled();
    restoreImage();
  });

  it("T2: saves the original transform and restores it after a successful export", async () => {
    const originalTransform = { k: 2.5, x: 100, y: 200 };
    const { mm, transformCalls, svgNode } = makeMarkmapMock({ currentTransform: originalTransform });
    const restoreImage = installFakeImage();
    try {
      await exportMindmapAsPNG(mm, "out.png");

      expect(transformCalls).toHaveLength(1);
      // Identity check: after the call, the live SVG's __zoom should be the
      // original transform object itself (d3-zoom writes the transform directly
      // when no transition is involved).
      expect(svgNode.__zoom).toBe(originalTransform);
    } finally {
      restoreImage();
    }
  });

  it("T3: still restores the transform when an export-pipeline step throws", async () => {
    const originalTransform = { k: 1.5, x: 50, y: 75 };
    const { mm, transformCalls, svgNode } = makeMarkmapMock({ currentTransform: originalTransform });

    // Force Blob construction to throw mid-pipeline. This propagates out of the
    // try-block and must trigger the outer finally.
    const OriginalBlob = globalThis.Blob;
    globalThis.Blob = class { constructor() { throw new Error("blobbing failed"); } };
    const restoreImage = installFakeImage();
    try {
      await expect(exportMindmapAsPNG(mm, "out.png")).rejects.toThrow("blobbing failed");

      expect(transformCalls).toHaveLength(1);
      // Identity check: after the call, the live SVG's __zoom should be the
      // original transform object itself (d3-zoom writes the transform directly
      // when no transition is involved).
      expect(svgNode.__zoom).toBe(originalTransform);
    } finally {
      globalThis.Blob = OriginalBlob;
      restoreImage();
    }
  });

  it("T4: canvas is sized to (state.rect content bounds + 60px padding) * 2, not clientWidth * 2", async () => {
    const contentRect = { x1: 100, x2: 2100, y1: 50, y2: 1550 };
    const { mm, svgNode } = makeMarkmapMock({ contentRect });
    Object.defineProperty(svgNode, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(svgNode, "clientHeight", { value: 600, configurable: true });

    let capturedCanvas = null;
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "canvas") capturedCanvas = el;
      return el;
    });
    const restoreImage = installFakeImage();
    try {
      await exportMindmapAsPNG(mm, "out.png");

      // (2100 - 100 + 60 * 2) * 2 = (2000 + 120) * 2 = 4240
      // (1550 - 50 + 60 * 2) * 2 = (1500 + 120) * 2 = 3240
      expect(capturedCanvas).not.toBeNull();
      expect(capturedCanvas.width).toBe(4240);
      expect(capturedCanvas.height).toBe(3240);
    } finally {
      createSpy.mockRestore();
      restoreImage();
    }
  });

  it("T5: triggers a download anchor with the given filename and a data: PNG href", async () => {
    const { mm } = makeMarkmapMock();
    const downloadCalls = [];
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "a") {
        el.click = vi.fn(() => {
          downloadCalls.push({ download: el.download, href: el.href });
        });
      }
      return el;
    });
    const restoreImage = installFakeImage();
    try {
      await exportMindmapAsPNG(mm, "my-mindmap.png");

      expect(downloadCalls).toHaveLength(1);
      expect(downloadCalls[0].download).toBe("my-mindmap.png");
      expect(downloadCalls[0].href.startsWith("data:image/png")).toBe(true);
    } finally {
      createSpy.mockRestore();
      restoreImage();
    }
  });

  it("T6: the live SVG node is unchanged after export (the clone is modified, not the live node)", async () => {
    const { mm, svgNode } = makeMarkmapMock();
    // Set distinctive attributes on the live SVG to detect any mutation.
    svgNode.setAttribute("width", "100%");
    svgNode.setAttribute("height", "100%");
    const liveWidthBefore = svgNode.getAttribute("width");
    const liveHeightBefore = svgNode.getAttribute("height");
    const liveViewBoxBefore = svgNode.getAttribute("viewBox");
    const restoreImage = installFakeImage();

    await exportMindmapAsPNG(mm, "test.png");

    expect(svgNode.getAttribute("width")).toBe(liveWidthBefore);
    expect(svgNode.getAttribute("height")).toBe(liveHeightBefore);
    expect(svgNode.getAttribute("viewBox")).toBe(liveViewBoxBefore);
    restoreImage();
  });

  it("T7: throws a clear error when mm.state.rect is all-zero (markmap not yet rendered)", async () => {
    const { mm } = makeMarkmapMock({ contentRect: { x1: 0, x2: 0, y1: 0, y2: 0 } });
    const restoreImage = installFakeImage();

    await expect(exportMindmapAsPNG(mm, "out.png")).rejects.toThrow(/state\.rect is empty/);
    restoreImage();
  });
});