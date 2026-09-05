/**
 * Browser page globals for Playwright `page.evaluate` / `page.waitForFunction`
 * callbacks. The tools run in Node (lib ES2023, types node): the DOM lib is absent
 * and @types/node deliberately omits page globals (window/document/location), so
 * closures executed in a real browser page fail name resolution here. This file
 * declares only the page-global names the callbacks actually use, with structural
 * types covering the members they touch. Runtime behavior is unchanged — types only.
 *
 * Each name is fresh (browserPageWindow, not window) because a bare `window`/`document`
 * declaration collides with TypeScript's bundled lib.dom once any file in the program
 * pulls it in. Callbacks reference these aliases instead; the alias documents that the
 * value exists only inside the browser page.
 */

interface BrowserPageDomRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface BrowserPageCssStyle {
  display: string;
  visibility: string;
  opacity: string;
  pointerEvents: string;
}

interface BrowserPageElement {
  readonly textContent: string | null;
  readonly style: BrowserPageCssStyle;
  readonly clientWidth: number;
  readonly clientHeight: number;
  className: string;
  disabled: boolean;
  appendChild(child: BrowserPageElement): void;
  getBoundingClientRect(): BrowserPageDomRect;
}

interface BrowserPageCanvas extends BrowserPageElement {
  width: number;
  height: number;
  getContext(contextId: string): BrowserPageGlContext | null;
  toDataURL(type?: string): string;
  captureStream(frameRate?: number): BrowserPageMediaStream;
}

export type { BrowserPageCanvas, BrowserPageGlContext, BrowserPageElement };

interface BrowserPageGlContext {
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void;
}

interface BrowserPageMediaTrack {
  stop(): void;
}

interface BrowserPageMediaStream {
  getTracks(): BrowserPageMediaTrack[];
}

interface BrowserPageRecorderEvent {
  readonly data: Blob;
}

interface BrowserPageRecorder {
  addEventListener(
    type: string,
    listener: (event: BrowserPageRecorderEvent) => void,
    options?: { once?: boolean },
  ): void;
  start(timeslice?: number): void;
  stop(): void;
}

interface BrowserPageDocument {
  getElementById(elementId: string): BrowserPageElement | null;
  querySelector(selector: "canvas"): BrowserPageCanvas | null;
  querySelector(selector: string): BrowserPageElement | null;
  querySelectorAll(selector: string): BrowserPageElement[];
  createElement(tagName: "canvas"): BrowserPageCanvas;
  createElement(tagName: string): BrowserPageElement;
  createElementNS(namespace: string, tagName: string): BrowserPageElement;
  hasFocus(): boolean;
}

interface BrowserPageLocation {
  readonly search: string;
  readonly href: string;
}

declare global {
  var browserPageWindow: {
    readonly document: BrowserPageDocument;
    readonly location: BrowserPageLocation;
    readonly innerWidth: number;
    readonly innerHeight: number;
    setInterval(handler: () => void, timeoutMs: number): number;
    clearInterval(handle: number): void;
  } & Record<string, any>;
  var browserPageDocument: BrowserPageDocument;
  function createBrowserPageRecorder(
    stream: BrowserPageMediaStream,
    options?: { mimeType?: string },
  ): BrowserPageRecorder;
  function browserPageRecorderSupports(mimeType: string): boolean;
}

export {};
