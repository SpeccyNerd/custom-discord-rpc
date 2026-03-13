const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rpcApi", {
  start: (payload) => ipcRenderer.invoke("rpc:start", payload),
  update: (payload) => ipcRenderer.invoke("rpc:update", payload),
  stop: () => ipcRenderer.invoke("rpc:stop")
});

contextBridge.exposeInMainWorld("rpcStatus", {
  onStatus: (callback) => {
    ipcRenderer.removeAllListeners("rpc:status");
    ipcRenderer.on("rpc:status", (_, status) => callback(status));
  }
});

contextBridge.exposeInMainWorld("windowControls", {
  hide: () => ipcRenderer.send("window:hide")
});

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
