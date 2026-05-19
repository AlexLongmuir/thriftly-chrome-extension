import { MESSAGE_TYPES, type ExtensionMessage } from "./shared/messages";
import { createPageSnapshot } from "./shared/pageSnapshot";

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== MESSAGE_TYPES.EXTRACT_PAGE_DATA) {
    return false;
  }

  sendResponse(createPageSnapshot(document, window.location));
  return true;
});
