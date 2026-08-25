import type { HybridClock } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";
import { compareClock } from "@pasteboard-pro/sync-protocol";

import type { ZToolsDocumentDatabase } from "./clipboard-store";

export type ShelfDockEdge = Exclude<DockEdge, "floating">;
export type MultiPasteMode = "batch" | "queue";
export type ThemeBackground =
  | Readonly<{ type: "default" }>
  | Readonly<{ type: "color"; color: string }>
  | Readonly<{ type: "image"; imageDataUrl: string }>;
export type ThemePreferences = Readonly<{
  accentColor: string;
  background: ThemeBackground;
}>;

export type WindowPreferences = Readonly<{
  dockEdge: ShelfDockEdge;
  multiPasteMode: MultiPasteMode;
  theme: ThemePreferences;
}>;

export type SyncedWindowPreferences = Readonly<{
  id: "window";
  entityType: "window_preferences";
  settings: WindowPreferences;
  updatedAt: string;
  sourceDeviceId: string;
  clock: HybridClock;
}>;

export const defaultWindowPreferences: WindowPreferences = {
  dockEdge: "bottom",
  multiPasteMode: "batch",
  theme: {
    accentColor: "#6f61ea",
    background: { type: "default" },
  },
};

const WINDOW_PREFERENCES_ID = "pasteboard-pro:settings:window";
const MAX_THEME_IMAGE_DATA_URL_LENGTH = Math.ceil((8 * 1_024 * 1_024 * 4) / 3) + 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

function isShelfDockEdge(value: unknown): value is ShelfDockEdge {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

function isMultiPasteMode(value: unknown): value is MultiPasteMode {
  return value === "batch" || value === "queue";
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function isThemeImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_THEME_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(value)
  );
}

function parseThemeBackground(value: unknown): ThemeBackground | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "default") return { type: "default" };
  if (value.type === "color" && isThemeColor(value.color)) {
    return { type: "color", color: value.color.toLowerCase() };
  }
  if (value.type === "image" && isThemeImageDataUrl(value.imageDataUrl)) {
    return { type: "image", imageDataUrl: value.imageDataUrl };
  }
  return undefined;
}

function parseThemePreferences(value: unknown): ThemePreferences {
  if (!isRecord(value)) return structuredClone(defaultWindowPreferences.theme);
  const background = parseThemeBackground(value.background);
  return {
    accentColor: isThemeColor(value.accentColor)
      ? value.accentColor.toLowerCase()
      : defaultWindowPreferences.theme.accentColor,
    background: background ?? { type: "default" },
  };
}

function parseWindowPreferences(value: unknown): WindowPreferences | undefined {
  if (!isRecord(value) || !isRecord(value.settings)) return undefined;
  return isShelfDockEdge(value.settings.dockEdge)
    ? {
        dockEdge: value.settings.dockEdge,
        multiPasteMode: isMultiPasteMode(value.settings.multiPasteMode)
          ? value.settings.multiPasteMode
          : defaultWindowPreferences.multiPasteMode,
        theme: parseThemePreferences(value.settings.theme),
      }
    : undefined;
}

export function parseSyncedWindowPreferences(
  value: unknown,
): SyncedWindowPreferences {
  if (
    !isRecord(value) ||
    value.id !== "window" ||
    value.entityType !== "window_preferences" ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    typeof value.sourceDeviceId !== "string" ||
    value.sourceDeviceId.length === 0 ||
    !isRecord(value.clock) ||
    !Number.isSafeInteger(value.clock.wallMs) ||
    !Number.isSafeInteger(value.clock.counter) ||
    Number(value.clock.counter) < 0 ||
    typeof value.clock.deviceId !== "string" ||
    value.clock.deviceId.length === 0
  ) {
    throw new TypeError("Invalid synced window preferences");
  }
  const settings = parseWindowPreferences({ settings: value.settings });
  if (settings === undefined) {
    throw new TypeError("Invalid synced window preference settings");
  }
  return {
    id: "window",
    entityType: "window_preferences",
    settings,
    updatedAt: value.updatedAt,
    sourceDeviceId: value.sourceDeviceId,
    clock: {
      wallMs: Number(value.clock.wallMs),
      counter: Number(value.clock.counter),
      deviceId: value.clock.deviceId,
    },
  };
}

type WindowPreferencesStoreOptions = Readonly<{
  deviceId?: string;
  now?: () => number;
}>;

export class ZToolsWindowPreferencesStore {
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    options: WindowPreferencesStoreOptions = {},
  ) {
    this.deviceId = options.deviceId?.trim() || "ztools-local";
    this.now = options.now ?? Date.now;
  }

  async get(): Promise<WindowPreferences> {
    try {
      return (
        parseWindowPreferences(await this.database.get(WINDOW_PREFERENCES_ID)) ??
        structuredClone(defaultWindowPreferences)
      );
    } catch (error) {
      if (isDatabaseStatus(error, 404)) {
        return structuredClone(defaultWindowPreferences);
      }
      throw error;
    }
  }

  async put(settings: WindowPreferences): Promise<void> {
    if (!isShelfDockEdge(settings.dockEdge)) {
      throw new TypeError("Shelf dock edge must be top, bottom, left, or right");
    }
    if (!isMultiPasteMode(settings.multiPasteMode)) {
      throw new TypeError("Multi-paste mode must be batch or queue");
    }
    if (!isRecord(settings.theme) || !isThemeColor(settings.theme.accentColor)) {
      throw new TypeError("Theme accent color must use #RRGGBB format");
    }
    if (parseThemeBackground(settings.theme.background) === undefined) {
      throw new TypeError("Theme background must be default, a #RRGGBB color, or an image data URL");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(WINDOW_PREFERENCES_ID);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      const currentSync = isRecord(current) && isRecord(current.sync)
        ? parseSyncedWindowPreferences(current.sync)
        : undefined;
      const wallMs = Math.max(
        Math.trunc(this.now()),
        (currentSync?.clock.wallMs ?? 0) + 1,
      );
      const sync: SyncedWindowPreferences = {
        id: "window",
        entityType: "window_preferences",
        settings: structuredClone(settings),
        updatedAt: new Date(wallMs).toISOString(),
        sourceDeviceId: this.deviceId,
        clock: { wallMs, counter: 0, deviceId: this.deviceId },
      };
      try {
        await this.database.put({
          _id: WINDOW_PREFERENCES_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-window-preferences",
          settings: structuredClone(settings),
          sync,
        });
        return;
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }

  async getSyncEntity(): Promise<SyncedWindowPreferences | undefined> {
    let document: unknown;
    try {
      document = await this.database.get(WINDOW_PREFERENCES_ID);
    } catch (error) {
      if (isDatabaseStatus(error, 404)) return undefined;
      throw error;
    }
    if (!isRecord(document) || !isRecord(document.sync)) return undefined;
    return parseSyncedWindowPreferences(document.sync);
  }

  async putSynced(entity: SyncedWindowPreferences): Promise<void> {
    const incoming = parseSyncedWindowPreferences(entity);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: unknown;
      try {
        current = await this.database.get(WINDOW_PREFERENCES_ID);
      } catch (error) {
        if (!isDatabaseStatus(error, 404)) throw error;
      }
      const currentSync = isRecord(current) && isRecord(current.sync)
        ? parseSyncedWindowPreferences(current.sync)
        : undefined;
      if (
        currentSync !== undefined &&
        compareClock(currentSync.clock, incoming.clock) >= 0
      ) {
        return;
      }
      const revision =
        isRecord(current) && typeof current._rev === "string"
          ? current._rev
          : undefined;
      try {
        await this.database.put({
          _id: WINDOW_PREFERENCES_ID,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-window-preferences",
          settings: structuredClone(incoming.settings),
          sync: structuredClone(incoming),
        });
        return;
      } catch (error) {
        if (!isDatabaseStatus(error, 409) || attempt === 2) throw error;
      }
    }
  }
}
