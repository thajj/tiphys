export type BrowserNotificationCategory =
  | "workflowSucceeded"
  | "workflowFailed";

export interface BrowserNotificationPreferences {
  muteAll: boolean;
  categories: Record<BrowserNotificationCategory, boolean>;
}

const NOTIFICATION_PREFERENCES_KEY = "wb-browser-notification-preferences";
const DELIVERED_NOTIFICATION_KEY = "wb-browser-notification-delivered";

export const defaultBrowserNotificationPreferences: BrowserNotificationPreferences = {
  muteAll: false,
  categories: {
    workflowSucceeded: true,
    workflowFailed: true,
  },
};

export const readBrowserNotificationPreferences = (): BrowserNotificationPreferences => {
  if (typeof window === "undefined") {
    return defaultBrowserNotificationPreferences;
  }

  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFERENCES_KEY);
    if (!raw) {
      return defaultBrowserNotificationPreferences;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserNotificationPreferences>;
    return {
      muteAll: parsed.muteAll === true,
      categories: {
        ...defaultBrowserNotificationPreferences.categories,
        ...(parsed.categories || {}),
      },
    };
  } catch {
    return defaultBrowserNotificationPreferences;
  }
};

export const saveBrowserNotificationPreferences = (
  preferences: BrowserNotificationPreferences,
) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    NOTIFICATION_PREFERENCES_KEY,
    JSON.stringify(preferences),
  );
};

export const readBrowserNotificationPermission = () =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

export const requestBrowserNotificationPermission = async () => {
  if (typeof Notification === "undefined") {
    return "unsupported" as const;
  }

  return Notification.requestPermission();
};

const readDelivered = () => {
  if (typeof window === "undefined") {
    return {} as Record<string, string>;
  }

  try {
    const raw = window.localStorage.getItem(DELIVERED_NOTIFICATION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const writeDelivered = (value: Record<string, string>) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DELIVERED_NOTIFICATION_KEY, JSON.stringify(value));
};

export const sendBrowserNotification = (
  preferences: BrowserNotificationPreferences,
  category: BrowserNotificationCategory,
  input: {
    title: string;
    body: string;
    tag: string;
  },
) => {
  if (
    preferences.muteAll ||
    !preferences.categories[category] ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false;
  }

  const delivered = readDelivered();
  if (delivered[input.tag] === input.body) {
    return false;
  }

  const notification = new Notification(input.title, {
    body: input.body,
    tag: input.tag,
  });
  notification.onshow = () => {
    writeDelivered({
      ...delivered,
      [input.tag]: input.body,
    });
  };
  return true;
};
