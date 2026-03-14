const { contextBridge, ipcRenderer } = require("electron");

/* =========================
   RPC API
========================= */
contextBridge.exposeInMainWorld("rpcApi", {
  start: (payload) => ipcRenderer.invoke("rpc:start", payload),
  update: (payload) => ipcRenderer.invoke("rpc:update", payload),
  stop: () => ipcRenderer.invoke("rpc:stop")
});

/* =========================
   RPC STATUS
========================= */
contextBridge.exposeInMainWorld("rpcStatus", {
  onStatus: (callback) => {
    ipcRenderer.removeAllListeners("rpc:status");
    ipcRenderer.on("rpc:status", (_, status) => callback(status));
  }
});

/* =========================
   WINDOW CONTROLS
========================= */
contextBridge.exposeInMainWorld("windowControls", {
  hide: () => ipcRenderer.send("window:hide")
});

/* =========================
   DISCORD AUTH
========================= */
contextBridge.exposeInMainWorld("discordAuth", {
  login: () => ipcRenderer.invoke("discord:login"),
  getUser: () => ipcRenderer.invoke("discord:get-user"),
  logout: () => ipcRenderer.invoke("discord:logout"),

  onUser: (callback) => {
    ipcRenderer.removeAllListeners("discord:user");
    ipcRenderer.on("discord:user", (_, user) => callback(user));
  },

  onError: (callback) => {
    ipcRenderer.removeAllListeners("discord:auth-error");
    ipcRenderer.on("discord:auth-error", (_, error) => callback(error));
  }
});

/* =========================
   APP SETTINGS (NEW)
========================= */
contextBridge.exposeInMainWorld("appSettings", {
  get: () => ipcRenderer.invoke("app:get-settings"),

  set: (patch) => ipcRenderer.invoke("app:set-settings", patch),

  onUpdate: (callback) => {
    ipcRenderer.removeAllListeners("app:settings");
    ipcRenderer.on("app:settings", (_, settings) => callback(settings));
  }
});
