import "@testing-library/jest-dom/vitest";

// jsdom 29 ships without the optional `canvas` peer dep, so
// HTMLCanvasElement.getContext('2d') returns null (or throws
// "Not implemented"). The mindmap PNG export utility and any
// future canvas-using code needs a working 2D context to be
// unit-testable, so we install a minimal stub here.
//
// This stub does NOT render anything — it only lets tests assert
// that the right methods were called with the right arguments
// (via vi.spyOn on the prototype methods if needed).
class StubCanvasRenderingContext2D {
  constructor() {
    this.fillStyle = "#000000";
  }
  scale() {}
  fillRect() {}
  drawImage() {}
  // Return a string that passes data:image/png prefix checks.
  toDataURL() { return "data:image/png;base64,iVBORw0KGgo="; }
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  writable: true,
  value() {
    return new StubCanvasRenderingContext2D();
  },
});

// jsdom's HTMLCanvasElement.prototype.toDataURL throws "Not implemented"
// when the optional `canvas` peer dep is absent. The export utility calls
// canvas.toDataURL('image/png') directly on the element, so we stub it here.
// Returning the same sentinel string lets tests assert that href starts with
// "data:image/png".
Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
  configurable: true,
  writable: true,
  value() {
    return "data:image/png;base64,iVBORw0KGgo=";
  },
});
