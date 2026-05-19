import { MESSAGE_TYPES, type ActiveTabExtraction } from "../shared/messages";

type RuntimeResponse =
  | {
      ok: true;
      result: ActiveTabExtraction;
    }
  | {
      ok: false;
      error: string;
    };

export async function requestActiveTabExtraction(): Promise<ActiveTabExtraction> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error("Chrome extension runtime is unavailable. Load the built dist folder as an unpacked extension.");
  }

  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.EXTRACT_ACTIVE_TAB
  })) as RuntimeResponse;

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.result;
}
