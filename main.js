const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomBytes, createHash } = require("crypto");
const { RpcManager } = require("./rpc");

/* =========================
   DISCORD OAUTH CONFIG
========================= */
const DISCORD_CLIENT_ID = "1374844549821632533";
const DISCORD_REDIRECT_URI = "speccyrpc://auth/callback";
const DISCORD_SCOPES = ["identify"];

/* =========================
   SINGLE INSTANCE LOCK
========================= */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let win;
let tray;
let rpcManager;
let isQuitting = false;

const USER_DATA = app.getPath("userData");
const WINDOW_STATE_FILE = path.join(USER_DATA, "window-state.json");
const AUTH_STATE_FILE = path.join(USER_DATA, "discord-auth.json");
const APP_SETTINGS_FILE = path.join(USER_DATA, "app-settings.json");

const TRAY_ICON_PATH = path.join(__dirname, "renderer", "assets", "tray.png");
const APP_ICON_PATH = path.join(__dirname, "renderer", "assets", "avatar.ico");

/* =========================
   AUTH SESSION
========================= */
let authSession = {
  state: null,
  codeVerifier: null
};

/* =========================
   APP SETTINGS
========================= */
const DEFAULT_APP_SETTINGS = {
  launchOnStartup: false,
  startHiddenToTray: false
};

function loadAppSettings() {
  try {
    if (fs.existsSync(APP_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, "utf8"));
      return { ...DEFAULT_APP_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.error("Failed to load app settings:", err);
  }

  return { ...DEFAULT_APP_SETTINGS };
}

function saveAppSettings(settings) {
  try {
    fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save app settings:", err);
  }
}

function applyLoginItemSettings(settings) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.launchOnStartup,
      openAsHidden: !!settings.startHiddenToTray
    });
  } catch (err) {
    console.error("Failed to apply login item settings:", err);
  }
}

function updateAppSettings(patch = {}) {
  const next = {
    ...loadAppSettings(),
    ...patch
  };

  saveAppSettings(next);
  applyLoginItemSettings(next);
  return next;
}

function wasOpenedAtLogin() {
  try {
    const info = app.getLoginItemSettings();
    return !!info.wasOpenedAtLogin;
  } catch {
    return false;
  }
}

/* =========================
   WINDOW STATE
========================= */
function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Failed to load window state:", err);
  }

  return { width: 750, height: 560 };
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;

  try {
    fs.writeFileSync(
      WINDOW_STATE_FILE,
      JSON.stringify(win.getBounds(), null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save window state:", err);
  }
}

/* =========================
   AUTH STORAGE
========================= */
function saveAuth(data) {
  try {
    fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save auth:", err);
  }
}

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_STATE_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Failed to load auth:", err);
  }

  return null;
}

function clearAuth() {
  try {
    if (fs.existsSync(AUTH_STATE_FILE)) {
      fs.unlinkSync(AUTH_STATE_FILE);
    }
  } catch (err) {
    console.error("Failed to clear auth:", err);
  }
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/* =========================
   HELPERS
========================= */
function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier() {
  return base64UrlEncode(randomBytes(64));
}

function createCodeChallenge(verifier) {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

function createState() {
  return base64UrlEncode(randomBytes(32));
}

function getAvatarUrl(user) {
  if (!user?.avatar) return null;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
}

function getBannerUrl(user) {
  if (!user?.banner) return null;
  const ext = user.banner.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=512`;
}

function normalizeDiscordUser(user) {
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name || null,
    discriminator: user.discriminator,
    avatar: getAvatarUrl(user),
    banner: getBannerUrl(user),
    accentColor: user.accent_color ?? null,
    premiumType: user.premium_type ?? 0,
    publicFlags: user.public_flags ?? 0,
    avatarDecoration: user.avatar_decoration_data ?? null,
    nameplate: user.collectibles?.nameplate ?? null,
    primaryGuild: user.primary_guild ?? null
  };
}

function buildAuthorizeUrl() {
  const state = createState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  authSession.state = state;
  authSession.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: DISCORD_REDIRECT_URI,
    scope: DISCORD_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent"
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: DISCORD_REDIRECT_URI,
    code_verifier: authSession.codeVerifier
  });

  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch user: ${response.status} ${text}`);
  }

  return response.json();
}

async function handleOAuthCallback(urlString) {
  try {
    const url = new URL(urlString);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      sendToRenderer("discord:auth-error", `Discord login failed: ${error}`);
      return;
    }

    if (!code || !state) {
      sendToRenderer("discord:auth-error", "Missing OAuth code or state.");
      return;
    }

    if (state !== authSession.state) {
      sendToRenderer("discord:auth-error", "Invalid OAuth state.");
      return;
    }

    const tokenData = await exchangeCodeForToken(code);
    const user = await fetchDiscordUser(tokenData.access_token);
    const normalizedUser = normalizeDiscordUser(user);

    saveAuth({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresIn: tokenData.expires_in || null,
      tokenType: tokenData.token_type || "Bearer",
      scope: tokenData.scope || "",
      user: normalizedUser
    });

    sendToRenderer("discord:user", normalizedUser);
  } catch (err) {
    console.error("OAuth callback error:", err);
    sendToRenderer("discord:auth-error", err.message || "Discord login failed.");
  } finally {
    authSession.state = null;
    authSession.codeVerifier = null;
  }
}

/* =========================
   WINDOW
========================= */
function createWindow() {
  const state = loadWindowState();
  const appSettings = loadAppSettings();
  const shouldStartHidden = !!appSettings.startHiddenToTray;

  win = new BrowserWindow({
    width: state.width || 750,
    height: state.height || 560,
    x: state.x,
    y: state.y,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    useContentSize: true,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0b0b0f",
    icon: APP_ICON_PATH,
    show: !shouldStartHidden,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e) => e.preventDefault());

  win.on("minimize", (e) => {
    e.preventDefault();
    win.hide();
  });

  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("move", saveWindowState);

  win.webContents.on("did-finish-load", () => {
    const saved = loadAuth();
    if (saved?.user) {
      sendToRenderer("discord:user", saved.user);
    }

    sendToRenderer("app:settings", loadAppSettings());
  });
}

/* =========================
   TRAY
========================= */
function createTray() {
  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip("Custom Discord RPC");

  const rebuildMenu = () => {
    const connected = rpcManager?.isConnected?.() === true;
    const settings = loadAppSettings();

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Show App",
          click: () => {
            if (win) {
              win.show();
              win.focus();
            }
          }
        },
        {
          label: "Hide App",
          click: () => {
            if (win) win.hide();
          }
        },
        { type: "separator" },
        {
          label: "Launch on Startup",
          type: "checkbox",
          checked: !!settings.launchOnStartup,
          click: (item) => {
            const updated = updateAppSettings({
              launchOnStartup: item.checked
            });
            sendToRenderer("app:settings", updated);
            rpcManager?.__rebuildTrayMenu?.();
          }
        },
        {
          label: "Start Hidden to Tray",
          type: "checkbox",
          checked: !!settings.startHiddenToTray,
          click: (item) => {
            const updated = updateAppSettings({
              startHiddenToTray: item.checked
            });
            sendToRenderer("app:settings", updated);
            rpcManager?.__rebuildTrayMenu?.();
          }
        },
        { type: "separator" },
        {
          label: "Disconnect RPC",
          enabled: connected,
          click: async () => {
            try {
              await rpcManager.stop();
            } catch (err) {
              console.error("Failed to stop RPC from tray:", err);
            }
          }
        },
        { type: "separator" },
        {
          label: "Quit",
          click: async () => {
            isQuitting = true;

            try {
              if (connected) {
                await rpcManager.stop();
              }
            } catch (err) {
              console.error("Failed to stop RPC on quit:", err);
            }

            saveWindowState();
            app.quit();
          }
        }
      ])
    );
  };

  rebuildMenu();

  tray.on("click", () => {
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  if (rpcManager) {
    rpcManager.__rebuildTrayMenu = rebuildMenu;
  }
}

/* =========================
   PROTOCOL
========================= */
function registerProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("speccyrpc", process.execPath, [
        path.resolve(process.argv[1])
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("speccyrpc");
  }
}

/* =========================
   APP READY
========================= */
app.whenReady().then(() => {
  registerProtocol();
  applyLoginItemSettings(loadAppSettings());

  rpcManager = new RpcManager((status) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("rpc:status", status);
    }

    rpcManager?.__rebuildTrayMenu?.();
  });

  createWindow();
  createTray();
});

/* =========================
   MAC URL HANDLER
========================= */
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
});

/* =========================
   SECOND INSTANCE
========================= */
app.on("second-instance", (_, commandLine) => {
  if (win) {
    win.show();
    win.focus();
  }

  const deepLink = commandLine.find((arg) => arg.startsWith("speccyrpc://"));
  if (deepLink) {
    handleOAuthCallback(deepLink);
  }
});

/* =========================
   IPC — RPC
========================= */
ipcMain.handle("rpc:start", (_, payload) => rpcManager.start(payload));
ipcMain.handle("rpc:update", (_, payload) => rpcManager.update(payload));
ipcMain.handle("rpc:stop", () => rpcManager.stop());

/* =========================
   IPC — WINDOW
========================= */
ipcMain.on("window:hide", () => {
  if (win) win.hide();
});

/* =========================
   IPC — APP SETTINGS
========================= */
ipcMain.handle("app:get-settings", () => {
  return loadAppSettings();
});

ipcMain.handle("app:set-settings", (_, patch) => {
  const updated = updateAppSettings(patch || {});
  sendToRenderer("app:settings", updated);
  rpcManager?.__rebuildTrayMenu?.();
  return updated;
});

/* =========================
   IPC — DISCORD AUTH
========================= */
ipcMain.handle("discord:login", async () => {
  const authUrl = buildAuthorizeUrl();
  await shell.openExternal(authUrl);
  return { ok: true };
});

ipcMain.handle("discord:get-user", () => {
  const saved = loadAuth();
  return saved?.user || null;
});

ipcMain.handle("discord:logout", () => {
  clearAuth();
  return { ok: true };
});
