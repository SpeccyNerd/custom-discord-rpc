const RPC = require("discord-rpc");

class RpcManager {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.client = null;
    this.clientId = null;
    this.connected = false;
    this.lastActivity = null;
  }

  isConnected() {
    return this.connected;
  }

  _emit(status) {
    try {
      this.onStatus?.(status);
    } catch {}
  }

  async start(payload) {
    const clientId = String(payload?.clientId || "").trim();

    if (!/^\d+$/.test(clientId)) {
      return { ok: false, error: "Client ID must be numeric" };
    }

    if (this.client || this.connected) {
      await this.stop();
    }

    console.log("[RPC] Starting with Client ID:", clientId);

    this.clientId = clientId;
    RPC.register(this.clientId);

    this.client = new RPC.Client({ transport: "ipc" });

    this.client.on("ready", async () => {
      console.log("[RPC] READY");
      this.connected = true;

      // 🔥 EMIT STRING STATUS (UI DEPENDS ON THIS)
      this._emit("connected");

      try {
        const activity = this.lastActivity || {
          details: "RPC Connected",
          state: "Electron App"
        };

        await this._setActivity(activity);
      } catch (e) {
        console.error("[RPC] Failed to set activity:", e);
      }
    });

    this.client.on("disconnected", () => {
      console.warn("[RPC] Disconnected");
      this.connected = false;

      // 🔥 EMIT STRING STATUS
      this._emit("disconnected");
    });

    this.client.on("error", (err) => {
      console.error("[RPC] ERROR:", err);
      this.connected = false;

      // 🔥 EMIT STRING STATUS
      this._emit("disconnected");
    });

    try {
      this.lastActivity = payload?.activity || null;

      await this.client.login({ clientId: this.clientId });

      console.log("[RPC] Login successful");
      return { ok: true };
    } catch (e) {
      console.error("[RPC] LOGIN FAILED:", e);
      await this.stop();
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async update(payload) {
    if (!this.client) {
      return { ok: false, error: "RPC not started" };
    }

    this.lastActivity = payload?.activity || null;

    if (!this.connected) {
      return { ok: true, queued: true };
    }

    try {
      await this._setActivity(this.lastActivity);
      return { ok: true };
    } catch (e) {
      console.error("[RPC] Update failed:", e);
      this.connected = false;
      this._emit("disconnected");
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async stop() {
    console.log("[RPC] Stopping");

    try {
      if (this.client && this.connected) {
        await this.client.clearActivity();
      }
    } catch {}

    try {
      if (this.client) {
        this.client.destroy();
      }
    } catch {}

    this.client = null;
    this.connected = false;

    // 🔥 EMIT STRING STATUS
    this._emit("disconnected");
    return { ok: true };
  }

  _normalizeActivity(activity) {
    const a = activity || {};
    const out = {};

    if (a.details) out.details = String(a.details).slice(0, 128);
    if (a.state) out.state = String(a.state).slice(0, 128);

    if (a.useTimestamp) out.startTimestamp = Date.now();

    if (a.largeImageKey) out.largeImageKey = String(a.largeImageKey);
    if (a.largeImageText) out.largeImageText = String(a.largeImageText);
    if (a.smallImageKey) out.smallImageKey = String(a.smallImageKey);
    if (a.smallImageText) out.smallImageText = String(a.smallImageText);

    const buttons = Array.isArray(a.buttons)
      ? a.buttons
          .filter(b => b?.label && b?.url)
          .slice(0, 2)
          .map(b => ({ label: b.label, url: b.url }))
      : [];

    if (buttons.length) out.buttons = buttons;

    return out;
  }

  async _setActivity(activity) {
    const normalized = this._normalizeActivity(activity);

    if (!normalized.details && !normalized.state) {
      normalized.details = "Custom RPC";
    }

    console.log("[RPC] Setting activity:", normalized);
    await this.client.setActivity(normalized);
  }
}

module.exports = { RpcManager };
