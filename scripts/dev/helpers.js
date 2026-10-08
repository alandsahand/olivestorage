// Helpers injected in front of every script run by cdp.mjs (they run inside the app page).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Type into a React-controlled input/select/textarea so React notices the change.
const setVal = (el, v) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
// First button whose text contains `text` (or whose aria-label equals it).
const btn = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(text) || b.getAttribute("aria-label") === text);
// The open dialog, if any.
const dlg = () => document.querySelector('[role="dialog"]');
