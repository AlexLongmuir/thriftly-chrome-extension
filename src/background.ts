import {
  MESSAGE_TYPES,
  type ActiveTabExtraction,
  type ExtensionMessage,
  type PageSnapshot
} from "./shared/messages";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab;
}

async function extractFromActiveTab(): Promise<ActiveTabExtraction> {
  const tab = await getActiveTab();

  try {
    const snapshot = (await chrome.tabs.sendMessage(tab.id!, {
      type: MESSAGE_TYPES.EXTRACT_PAGE_DATA
    })) as PageSnapshot;

    return {
      tabId: tab.id!,
      tabUrl: tab.url,
      snapshot
    };
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      files: ["contentScript.js"]
    });

    const snapshot = (await chrome.tabs.sendMessage(tab.id!, {
      type: MESSAGE_TYPES.EXTRACT_PAGE_DATA
    })) as PageSnapshot;

    return {
      tabId: tab.id!,
      tabUrl: tab.url,
      snapshot
    };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== MESSAGE_TYPES.EXTRACT_ACTIVE_TAB) {
    return false;
  }

  extractFromActiveTab()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : "Unknown extraction error.";
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});
