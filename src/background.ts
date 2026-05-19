import {
  MESSAGE_TYPES,
  type ActiveTabExtraction,
  type ExtensionMessage,
  type PageSnapshot
} from "./shared/messages";
import { enrichPageSnapshotWithRetailerFallbacks } from "./shared/retailerFallbacks";

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
  let snapshot: PageSnapshot;

  try {
    snapshot = (await chrome.tabs.sendMessage(tab.id!, {
      type: MESSAGE_TYPES.EXTRACT_PAGE_DATA
    })) as PageSnapshot;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      files: ["contentScript.js"]
    });

    snapshot = (await chrome.tabs.sendMessage(tab.id!, {
      type: MESSAGE_TYPES.EXTRACT_PAGE_DATA
    })) as PageSnapshot;
  }

  await withRetailerHeaderRules(() => enrichPageSnapshotWithRetailerFallbacks(snapshot, new URL(snapshot.url)));

  return {
    tabId: tab.id!,
    tabUrl: tab.url,
    snapshot
  };
}

async function withRetailerHeaderRules<T>(callback: () => Promise<T>): Promise<T> {
  const allSaintsCrawlerRuleId = 9001;
  const canModifyHeaders = Boolean(chrome.declarativeNetRequest?.updateSessionRules);

  if (!canModifyHeaders) return callback();

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [allSaintsCrawlerRuleId],
    addRules: [
      {
        id: allSaintsCrawlerRuleId,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: "user-agent",
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
            }
          ]
        },
        condition: {
          requestDomains: ["www.allsaints.com"],
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
        }
      }
    ]
  });

  try {
    return await callback();
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [allSaintsCrawlerRuleId]
    });
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
