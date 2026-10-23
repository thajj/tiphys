import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultBrowserNotificationPreferences,
  readBrowserNotificationPreferences,
  saveBrowserNotificationPreferences,
  sendBrowserNotification,
} from "./notificationPreferences";

class MockNotification {
  static permission: NotificationPermission = "granted";
  static instances: MockNotification[] = [];

  onshow: (() => void) | null = null;

  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    MockNotification.instances.push(this);
  }
}

describe("notificationPreferences", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    MockNotification.instances = [];
    vi.stubGlobal("Notification", MockNotification);
  });

  it("persists browser notification preferences in local storage", () => {
    const next = {
      muteAll: true,
      categories: {
        ...defaultBrowserNotificationPreferences.categories,
        workflowSucceeded: false,
      },
    };

    saveBrowserNotificationPreferences(next);

    expect(readBrowserNotificationPreferences()).toEqual(next);
  });

  it("dedupes delivered notifications by tag and body", () => {
    const sent = sendBrowserNotification(
      defaultBrowserNotificationPreferences,
      "workflowFailed",
      {
        title: "Workflow failed",
        body: "demo-run failed",
        tag: "workflow:demo-run",
      },
    );

    expect(sent).toBe(true);
    expect(MockNotification.instances).toHaveLength(1);

    MockNotification.instances[0].onshow?.();

    const deduped = sendBrowserNotification(
      defaultBrowserNotificationPreferences,
      "workflowFailed",
      {
        title: "Workflow failed",
        body: "demo-run failed",
        tag: "workflow:demo-run",
      },
    );

    expect(deduped).toBe(false);
    expect(MockNotification.instances).toHaveLength(1);
  });
});
