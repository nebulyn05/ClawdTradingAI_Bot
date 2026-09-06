"use client";

import { useEffect } from "react";

/**
 * globals.css has a sitewide blur-up rule:
 *   img:not([data-loaded=true]) { opacity: 0; filter: blur(14px); ... }
 *   img[data-loaded=true] { opacity: 1; filter: none; ... }
 * In the original site, a React onLoad handler set `data-loaded="true"`
 * once each image actually finished loading. That handler doesn't exist
 * here, so every image stays permanently invisible (loads fine as a file —
 * openable directly — but never gets marked loaded, so the CSS never
 * reveals it). This restores that behavior with a real `load` listener,
 * including for images that are already cached/complete by the time this
 * effect runs, and treats a failed load the same way (better a broken-image
 * icon than an invisible gap forever).
 *
 * The marquee sections duplicate the same logo `src` twice (for the
 * seamless-loop illusion). With that many identical-URL `<img>` tags parsed
 * at once, some duplicates' own `load` event fires much later than their
 * sibling's — even though the browser already has the bytes cached from the
 * first one. Rather than trust each element's own event, track which `src`
 * values are confirmed loaded and immediately mark every element sharing
 * that `src`, so a slow/delayed duplicate rides on its sibling's load.
 */
export function ImageAutoLoad() {
  useEffect(() => {
    const loadedSrcs = new Set<string>();

    function markLoaded(img: HTMLImageElement) {
      img.setAttribute("data-loaded", "true");
      const src = img.getAttribute("src");
      if (!src || loadedSrcs.has(src)) return;
      loadedSrcs.add(src);
      document
        .querySelectorAll<HTMLImageElement>(`img[src="${CSS.escape(src)}"]`)
        .forEach((sibling) => sibling.setAttribute("data-loaded", "true"));
    }

    function handle(img: HTMLImageElement) {
      if (img.hasAttribute("data-loaded")) return;
      const src = img.getAttribute("src");
      if (src && loadedSrcs.has(src)) {
        markLoaded(img);
        return;
      }
      if (img.complete && img.naturalWidth > 0) {
        markLoaded(img);
        return;
      }
      img.addEventListener("load", () => markLoaded(img), { once: true });
      img.addEventListener("error", () => markLoaded(img), { once: true });
    }

    document.querySelectorAll("img").forEach((img) => handle(img as HTMLImageElement));

    // Catch anything whose `load`/`error` event fired before this effect
    // even ran, or that a stalled duplicate never fires on its own.
    const settleInterval = setInterval(() => {
      document.querySelectorAll<HTMLImageElement>("img:not([data-loaded])").forEach((img) => handle(img));
    }, 200);
    const stopSettling = setTimeout(() => clearInterval(settleInterval), 8000);

    // dangerouslySetInnerHTML content is static after mount, but guard
    // against any future dynamic content anyway.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.tagName === "IMG") handle(node as HTMLImageElement);
          node.querySelectorAll?.("img").forEach((img) => handle(img as HTMLImageElement));
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearInterval(settleInterval);
      clearTimeout(stopSettling);
    };
  }, []);

  return null;
}
