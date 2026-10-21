import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's automatic cleanup requires global afterEach; register it explicitly
// so every test starts from an empty document.
afterEach(() => {
  cleanup();
});

// jsdom does not implement these browser APIs, which Motion for React
// touches (matchMedia for reduced-motion, observers for in-view/layout).
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!window.IntersectionObserver) {
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: number[] = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    Object.defineProperty(window, "IntersectionObserver", { writable: true, value: MockIntersectionObserver });
  }

  if (!window.ResizeObserver) {
    class MockResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", { writable: true, value: MockResizeObserver });
  }
}
