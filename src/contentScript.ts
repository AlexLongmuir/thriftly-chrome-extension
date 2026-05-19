import { MESSAGE_TYPES, type ExtensionMessage } from "./shared/messages";
import type { EvidenceSnippet } from "./shared/messages";
import { createPageSnapshot, enrichProductWithEvidenceSnippets } from "./shared/pageSnapshot";
import { createPageSnapshotWithRetailerFallbacks } from "./shared/retailerFallbacks";

const DISCLOSURE_LABEL_PATTERN =
  /\b(product measurements|measurements|composition|care|origin|product details|details|materials|fabric|fabric & care|size & fit|specs|features|shipping|returns)\b/i;
const CAPTURE_TEXT_PATTERN =
  /\b(composition|care|origin|product details|materials|fabric|made in|shell|lining|body|fit|model|measurements|specs|features)\b/i;
const MAX_DISCLOSURE_CLICKS = 10;
const DISCLOSURE_WAIT_MS = 300;
const RESTORE_WAIT_MS = 60;

type DisclosureState = {
  element: HTMLElement;
  ariaExpanded: string | null;
  detailsOpen: boolean | null;
};

type PageInteractionState = {
  scrollX: number;
  scrollY: number;
  href: string;
  activeElement: HTMLElement | null;
  disclosures: DisclosureState[];
  visibleOverlays: HTMLElement[];
  bodyClass: string | null;
  bodyStyle: string | null;
  documentClass: string | null;
  documentStyle: string | null;
};

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== MESSAGE_TYPES.EXTRACT_PAGE_DATA) {
    return false;
  }

  captureActivePageSnapshot()
    .then(sendResponse)
    .catch(() => sendResponse(createPageSnapshot(document, window.location)));
  return true;
});

async function captureActivePageSnapshot() {
  const interactiveSnippets = await captureInteractiveDisclosureSnippets(document);
  const snapshot = await createPageSnapshotWithRetailerFallbacks(document, window.location);
  return enrichProductWithEvidenceSnippets(snapshot, interactiveSnippets);
}

async function captureInteractiveDisclosureSnippets(documentRef: Document): Promise<EvidenceSnippet[]> {
  const previousState = capturePageInteractionState(documentRef);
  const controls = findDisclosureControls(documentRef).slice(0, MAX_DISCLOSURE_CLICKS);
  const snippets: EvidenceSnippet[] = [];
  const seen = new Set<string>();

  try {
    for (const control of controls) {
      const label = normaliseWhitespace(
        control.getAttribute("aria-label") ||
          control.getAttribute("title") ||
          control.textContent ||
          control.id ||
          control.className ||
          "product disclosure"
      );
      const before = normaliseWhitespace(documentRef.body?.innerText || "");

      if (!clickElement(control)) continue;
      await delay(DISCLOSURE_WAIT_MS);

      const captured = collectRelevantVisibleText(documentRef, control, before, label);
      for (const text of captured) {
        const key = text.toLowerCase().slice(0, 240);
        if (seen.has(key)) continue;
        seen.add(key);
        snippets.push({ source: "dom_targeted", label: `interactive disclosure: ${label}`, text });
      }

      closeOpenDisclosure(documentRef);
      await delay(RESTORE_WAIT_MS);
    }
  } finally {
    await restorePageInteractionState(documentRef, previousState);
  }

  return snippets;
}

function findDisclosureControls(documentRef: Document): HTMLElement[] {
  const selectors = [
    "button",
    "summary",
    "[role='button']",
    "[aria-controls]",
    "[aria-expanded]",
    "a[href='#']",
    "li",
    "div"
  ];
  const nodes = Array.from(documentRef.querySelectorAll(selectors.join(","))) as HTMLElement[];
  const seen = new Set<HTMLElement>();
  const controls: HTMLElement[] = [];

  for (const node of nodes) {
    if (seen.has(node) || !isVisible(node)) continue;

    const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.textContent || ""}`;
    if (!DISCLOSURE_LABEL_PATTERN.test(label)) continue;
    if (normaliseWhitespace(label).length > 140) continue;

    seen.add(node);
    controls.push(node);
  }

  return controls;
}

function collectRelevantVisibleText(documentRef: Document, control: HTMLElement, before: string, label: string): string[] {
  const candidates = [
    ...Array.from(documentRef.querySelectorAll("[role='dialog'], [aria-modal='true'], [class*='modal' i], [class*='drawer' i], [class*='panel' i], [class*='accordion' i]")) as HTMLElement[],
    control.closest("section, article, details, div") as HTMLElement | null,
    documentRef.body
  ].filter(Boolean) as HTMLElement[];

  const texts = candidates
    .map((node) => normaliseWhitespace(node.innerText || node.textContent || ""))
    .filter((text) => text.length >= 30 && text.length <= 5000)
    .filter((text) => CAPTURE_TEXT_PATTERN.test(`${label} ${text}`));

  const after = normaliseWhitespace(documentRef.body?.innerText || "");
  const diff = after.length > before.length ? after.replace(before, "").trim() : "";
  if (diff.length >= 30 && diff.length <= 5000 && CAPTURE_TEXT_PATTERN.test(`${label} ${diff}`)) texts.unshift(diff);

  return uniqueStrings(texts).slice(0, 3);
}

function clickElement(element: HTMLElement): boolean {
  try {
    element.click();
    return true;
  } catch {
    return false;
  }
}

function closeOpenDisclosure(documentRef: Document): void {
  closeVisibleOverlays(documentRef, []);
}

function closeVisibleOverlays(documentRef: Document, previouslyVisible: HTMLElement[]): void {
  const previous = new Set(previouslyVisible);
  const overlays = findVisibleOverlays(documentRef)
    .filter((overlay) => !previous.has(overlay))
    .sort((a, b) => modalRank(b) - modalRank(a));

  for (const overlay of overlays) {
    if (clickOverlayCloseButton(overlay)) continue;
    clickBackdropOrDispatchEscape(documentRef, overlay);
    if (isVisible(overlay)) forceHideOverlay(overlay);
  }

  clickHashTargetCloseButton(documentRef);
  documentRef.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function clickOverlayCloseButton(overlay: HTMLElement): boolean {
  const selectors = [
    "button[aria-label*='close' i]",
    "button[title*='close' i]",
    "a[aria-label*='close' i]",
    "a[title*='close' i]",
    "a[class*='close' i]",
    "[role='button'][aria-label*='close' i]",
    "[data-dismiss='modal']",
    "[data-bs-dismiss='modal']",
    "[data-dialog-close]",
    "[class*='close' i]",
    "button"
  ];

  const candidates = Array.from(overlay.querySelectorAll(selectors.join(",")))
    .filter((node): node is HTMLElement => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
      const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.textContent || ""} ${node.className || ""}`;
      return /close|dismiss|×|x/i.test(label);
    })
    .sort((a, b) => closeControlRank(b) - closeControlRank(a));

  for (const closeButton of candidates) {
    clickElement(closeButton);
    if (!isVisible(overlay)) return true;
  }

  return false;
}

function closeControlRank(element: HTMLElement): number {
  const tag = element.tagName.toLowerCase();
  const interactive = tag === "button" || tag === "a" || element.getAttribute("role") === "button" ? 10 : 0;
  const explicitClose = /close|dismiss/i.test(
    `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.className || ""}`
  )
    ? 5
    : 0;
  return interactive + explicitClose;
}

function forceHideOverlay(overlay: HTMLElement): void {
  overlay.classList.remove("show", "open", "is-open", "active", "is-active");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("hidden", "");
  overlay.style.display = "none";
}

function clickBackdropOrDispatchEscape(documentRef: Document, overlay: HTMLElement): void {
  clickElement(overlay);
  overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  documentRef.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function clickHashTargetCloseButton(documentRef: Document): void {
  if (!window.location.hash) return;

  const target = documentRef.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (target instanceof HTMLElement) {
    clickOverlayCloseButton(target);
  }
}

function findVisibleOverlays(documentRef: Document): HTMLElement[] {
  const selectors = [
    "[role='dialog']",
    "[aria-modal='true']",
    "[class*='modal' i]",
    "[class*='drawer' i]",
    "[class*='overlay' i]",
    "[class*='popover' i]",
    "[data-modal]",
    "[data-testid*='modal' i]",
    "[id*='modal' i]"
  ];

  return uniqueElements(
    Array.from(documentRef.querySelectorAll(selectors.join(","))).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== documentRef.body &&
        node !== documentRef.documentElement &&
        looksLikeOverlayContainer(node) &&
        isVisible(node)
    )
  );
}

function looksLikeOverlayContainer(element: HTMLElement): boolean {
  if (element.getAttribute("role") === "dialog" || element.getAttribute("aria-modal") === "true") return true;
  if (/(^|[-_])modal$/i.test(element.id) || /modal$/i.test(element.id)) return true;

  const classTokens = String(element.className || "").split(/\s+/).filter(Boolean);
  return classTokens.some((token) => /^(modal|drawer|overlay|popover)$/i.test(token));
}

function modalRank(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const zIndex = Number.parseInt(style.zIndex || "0", 10);
  const modalWeight = /modal|dialog/i.test(`${element.id} ${element.className} ${element.getAttribute("role") || ""}`) ? 10000 : 0;
  return (Number.isFinite(zIndex) ? zIndex : 0) + modalWeight;
}

function capturePageInteractionState(documentRef: Document): PageInteractionState {
  const disclosureNodes = Array.from(documentRef.querySelectorAll("details, [aria-expanded]")) as HTMLElement[];

  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    href: window.location.href,
    activeElement: documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null,
    disclosures: disclosureNodes.map((element) => ({
      element,
      ariaExpanded: element.getAttribute("aria-expanded"),
      detailsOpen: element instanceof HTMLDetailsElement ? element.open : null
    })),
    visibleOverlays: findVisibleOverlays(documentRef),
    bodyClass: documentRef.body?.getAttribute("class") || null,
    bodyStyle: documentRef.body?.getAttribute("style") || null,
    documentClass: documentRef.documentElement.getAttribute("class"),
    documentStyle: documentRef.documentElement.getAttribute("style")
  };
}

async function restorePageInteractionState(documentRef: Document, state: PageInteractionState): Promise<void> {
  closeVisibleOverlays(documentRef, state.visibleOverlays);
  await delay(RESTORE_WAIT_MS);

  for (const disclosure of state.disclosures) {
    if (!documentRef.contains(disclosure.element)) continue;

    if (disclosure.detailsOpen !== null && disclosure.element instanceof HTMLDetailsElement) {
      disclosure.element.open = disclosure.detailsOpen;
    }

    if (disclosure.ariaExpanded !== null && disclosure.element.getAttribute("aria-expanded") !== disclosure.ariaExpanded) {
      clickElement(disclosure.element);
      await delay(RESTORE_WAIT_MS);
      if (documentRef.contains(disclosure.element)) {
        disclosure.element.setAttribute("aria-expanded", disclosure.ariaExpanded);
      }
    }
  }

  if (state.activeElement && documentRef.contains(state.activeElement)) {
    state.activeElement.focus({ preventScroll: true });
  }

  restoreDocumentAttribute(documentRef.body, "class", state.bodyClass);
  restoreDocumentAttribute(documentRef.body, "style", state.bodyStyle);
  restoreDocumentAttribute(documentRef.documentElement, "class", state.documentClass);
  restoreDocumentAttribute(documentRef.documentElement, "style", state.documentStyle);
  restoreUrl(state.href);
  window.scrollTo(state.scrollX, state.scrollY);
}

function restoreDocumentAttribute(element: Element | null, name: string, value: string | null): void {
  if (!element) return;
  if (value === null) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value);
}

function restoreUrl(href: string): void {
  if (window.location.href === href) return;

  try {
    window.history.replaceState(window.history.state, document.title, href);
  } catch {
    if (window.location.hash && !href.includes("#")) window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);
  }
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 1 && rect.height >= 1;
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = normaliseWhitespace(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function uniqueElements<T extends Element>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
