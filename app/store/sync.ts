import { getClientConfig } from "../config/client";
import { ApiPath, STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  getLocalAppState,
  GetStoreState,
  mergeAppState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;

export enum SyncAction {
  SYNC = "SYNC",
  UPLOAD = "UPLOAD",
  DOWNLOAD = "DOWNLOAD",
}

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.WebDAV,
  useProxy: true,
  proxyUrl: ApiPath.Cors as string,

  webdav: {
    endpoint: "https://dav.jyj.cx",
    username: "",
    password: "",
  },

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const config = get()[get().provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({ lastSyncTime: Date.now(), lastProvider: get().provider });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async sync(action: SyncAction = SyncAction.SYNC) {
      if (!(await this.hasAccount())) {
        console.log("[Sync] No account found, skipping sync.");
        return;
      }

      const localState = getLocalAppState();
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();

      if (action === SyncAction.SYNC) {
        console.log("[Sync] Syncing state", config.username);
        try {
          const remoteState = await client.get(config.username);
          if (!remoteState || remoteState === "") {
            await client.set(config.username, JSON.stringify(localState));
            console.log(
              "[Sync] Remote state is empty, using local state instead.",
            );
            return;
          } else {
            const parsedRemoteState = JSON.parse(
              await client.get(config.username),
            ) as AppState;
            mergeAppState(localState, parsedRemoteState);
            setLocalAppState(localState);
          }
        } catch (e) {
          console.log("[Sync] failed to get remote state", e);
          throw e;
        }
        await client.set(config.username, JSON.stringify(localState));
      } else if (action === SyncAction.UPLOAD) {
        console.log("[Sync] Uploading state", localState);
        await client.set(config.username, JSON.stringify(localState));
      } else if (action === SyncAction.DOWNLOAD) {
        console.log("[Sync] Downloading state", config.username);
        const remoteState = await client.get(config.username);
        if (!remoteState || remoteState === "") {
          console.log(
            "[Sync] Remote state is empty, using local state instead.",
          );
          return;
        } else {
          const parsedRemoteState = JSON.parse(remoteState) as AppState;
          setLocalAppState(parsedRemoteState);
        }
      }

      this.markSyncTime();
    },

    async download() {
      await this.sync(SyncAction.DOWNLOAD);
    },

    async upload() {
      await this.sync(SyncAction.UPLOAD);
    },

    async hasAccount() {
      const provider = get().provider;
      const config = get()[provider] as any;
      console.log("[Sync] hasAccount", provider, config);
      // console.log("[Sync] hasAccount", !!(provider === ProviderType.WebDAV ? config.username && config.password : config.username && config.apiKey));
      return provider === ProviderType.WebDAV
        ? config.username && config.password
        : config.username && config.apiKey;
    },

    async check() {
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.2,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      return newState as any;
    },
  },
);
