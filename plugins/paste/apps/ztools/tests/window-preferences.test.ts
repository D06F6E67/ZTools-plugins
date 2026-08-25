import { describe, expect, it } from "vitest";

import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";

describe("ZTools window preferences", () => {
  it("defaults to the bottom edge when no local setting exists", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() { throw { status: 404 }; },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
  });

  it("persists a four-edge dock preference and retries conflicts", async () => {
    let document: Record<string, unknown> | undefined;
    let conflict = true;
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        if (conflict) {
          conflict = false;
          throw { status: 409 };
        }
        document = { ...structuredClone(next), _rev: "2-test" };
        return { ok: true };
      },
    });

    await store.put({
      dockEdge: "left",
      multiPasteMode: "queue",
      theme: {
        accentColor: "#336699",
        background: { type: "color", color: "#f0eedd" },
      },
    });
    await expect(store.get()).resolves.toEqual({
      dockEdge: "left",
      multiPasteMode: "queue",
      theme: {
        accentColor: "#336699",
        background: { type: "color", color: "#f0eedd" },
      },
    });
  });

  it("persists a portable image theme and exposes it as a WebDAV sync entity", async () => {
    let document: Record<string, unknown> | undefined;
    const store = new ZToolsWindowPreferencesStore(
      {
        async get() {
          if (document === undefined) throw { status: 404 };
          return structuredClone(document);
        },
        async put(next) {
          document = { ...structuredClone(next), _rev: "1-test" };
          return { ok: true };
        },
      },
      { deviceId: "device-a", now: () => 1_700_000_000_000 },
    );

    const settings = {
      dockEdge: "right" as const,
      multiPasteMode: "batch" as const,
      theme: {
        accentColor: "#224466",
        background: {
          type: "image" as const,
          imageDataUrl: "data:image/png;base64,iVBORw==",
        },
      },
    };
    await store.put(settings);

    await expect(store.get()).resolves.toEqual(settings);
    await expect(store.getSyncEntity()).resolves.toMatchObject({
      id: "window",
      entityType: "window_preferences",
      settings,
      sourceDeviceId: "device-a",
      clock: { wallMs: 1_700_000_000_000, deviceId: "device-a" },
    });
  });

  it("applies only newer synced appearance preferences", async () => {
    let document: Record<string, unknown> | undefined;
    const database = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next: Record<string, unknown>) {
        document = { ...structuredClone(next), _rev: "next" };
        return { ok: true };
      },
    };
    const store = new ZToolsWindowPreferencesStore(database, {
      deviceId: "device-a",
      now: () => 200,
    });
    await store.put(defaultWindowPreferences);
    await store.putSynced({
      id: "window",
      entityType: "window_preferences",
      settings: {
        ...defaultWindowPreferences,
        theme: {
          accentColor: "#123456",
          background: { type: "color", color: "#abcdef" },
        },
      },
      updatedAt: new Date(300).toISOString(),
      sourceDeviceId: "device-b",
      clock: { wallMs: 300, counter: 0, deviceId: "device-b" },
    });

    await expect(store.get()).resolves.toMatchObject({
      theme: {
        accentColor: "#123456",
        background: { type: "color", color: "#abcdef" },
      },
    });
  });

  it("migrates an existing dock-only preference to batch multi-paste", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return { settings: { dockEdge: "top" } };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual({
      dockEdge: "top",
      multiPasteMode: "batch",
      theme: defaultWindowPreferences.theme,
    });
  });

  it("rejects invalid persisted and requested edges safely", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return { settings: { dockEdge: "floating" } };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
    await expect(
      store.put({ dockEdge: "floating" } as never),
    ).rejects.toThrow(/top, bottom, left, or right/i);
  });

  it("falls back from invalid persisted theme values and rejects invalid writes", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return {
          settings: {
            dockEdge: "bottom",
            multiPasteMode: "batch",
            theme: {
              accentColor: "red",
              background: { type: "image", imageDataUrl: "https://example.com/a.png" },
            },
          },
        };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
    await expect(
      store.put({
        dockEdge: "bottom",
        multiPasteMode: "batch",
        theme: { accentColor: "red", background: { type: "default" } },
      }),
    ).rejects.toThrow(/#RRGGBB/i);
  });
});
