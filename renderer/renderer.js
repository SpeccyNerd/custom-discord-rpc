const $id = (id) => document.getElementById(id);
const $ = (sel) => document.querySelector(sel);

let lastActivity = null;
let rpcState = "disconnected";
// disconnected | connecting | connected

let discordUser = null;

/* =========================
   TOAST (USES EXISTING HTML)
========================= */
function showToast(message, type = "error", duration = 3000) {
  const container = $id("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/* =========================
   VALIDATION HELPERS
========================= */
function hasMinChars(value, min = 2) {
  return typeof value === "string" && value.trim().length >= min;
}

function markInvalid(inputId, invalid) {
  const el = $id(inputId);
  if (!el) return;
  el.classList.toggle("input-error", invalid);
}

/* =========================
   AUTO SAVE
========================= */
const SETTINGS_KEY = "speccy_rpc_settings_v1";

const SAVE_FIELDS = [
  "appId",
  "rpcAppName",
  "rpcLine1",
  "rpcLine2",
  "button1Label",
  "button1Url",
  "button2Label",
  "button2Url",
  "imageUrl",
  "smallImageUrl",
  "autoConnect"
];

function getSettingsFromForm() {
  const data = {};

  for (const id of SAVE_FIELDS) {
    const el = $id(id);
    if (!el) continue;

    if (el.type === "checkbox") {
      data[id] = el.checked;
    } else {
      data[id] = el.value ?? "";
    }
  }

  return data;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(getSettingsFromForm()));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load settings:", err);
    return null;
  }
}

function applySettings(settings) {
  if (!settings) return;

  for (const id of SAVE_FIELDS) {
    const el = $id(id);
    if (!el || !(id in settings)) continue;

    if (el.type === "checkbox") {
      el.checked = !!settings[id];
    } else {
      el.value = settings[id] ?? "";
    }
  }
}

/* =========================
   APP SETTINGS UI
========================= */
async function loadAppSettingsUI() {
  try {
    if (!window.appSettings?.get) return;

    const settings = await window.appSettings.get();

    const launchEl = $id("launchOnStartup");
    const hiddenEl = $id("startHiddenToTray");

    if (launchEl) launchEl.checked = !!settings.launchOnStartup;
    if (hiddenEl) hiddenEl.checked = !!settings.startHiddenToTray;
  } catch (err) {
    console.error("Failed to load app settings:", err);
  }
}

function bindAppSettingsUI() {
  const launchEl = $id("launchOnStartup");
  const hiddenEl = $id("startHiddenToTray");

  launchEl?.addEventListener("change", async () => {
    try {
      await window.appSettings?.set({
        launchOnStartup: !!launchEl.checked
      });
      showToast("Startup setting saved", "success", 1500);
    } catch (err) {
      console.error("Failed to update launchOnStartup:", err);
      showToast("Failed to save startup setting", "error");
    }
  });

  hiddenEl?.addEventListener("change", async () => {
    try {
      await window.appSettings?.set({
        startHiddenToTray: !!hiddenEl.checked
      });
      showToast("Tray startup setting saved", "success", 1500);
    } catch (err) {
      console.error("Failed to update startHiddenToTray:", err);
      showToast("Failed to save tray startup setting", "error");
    }
  });

  window.appSettings?.onUpdate?.((settings) => {
    if (launchEl) launchEl.checked = !!settings.launchOnStartup;
    if (hiddenEl) hiddenEl.checked = !!settings.startHiddenToTray;
  });
}

/* =========================
   CONNECT BUTTON UI
========================= */
function updateConnectButton() {
  const btn = $id("connectToggleBtn");
  const updateBtn = $id("updateBtn");
  if (!btn) return;

  btn.classList.remove("connected", "disconnected", "connecting");

  if (rpcState === "disconnected") {
    btn.textContent = "Connect";
    btn.classList.add("connected");
    btn.disabled = false;
    if (updateBtn) updateBtn.disabled = true;
  }

  if (rpcState === "connecting") {
    btn.textContent = "Connecting...";
    btn.classList.add("connecting");
    btn.disabled = true;
    if (updateBtn) updateBtn.disabled = true;
  }

  if (rpcState === "connected") {
    btn.textContent = "Disconnect";
    btn.classList.add("disconnected");
    btn.disabled = false;
    if (updateBtn) updateBtn.disabled = false;
  }
}

/* =========================
   DISCORD USER UI
========================= */
function getLoginButton() {
  return (
    $id("loginDiscordBtn") ||
    $id("discordLoginBtn") ||
    document.querySelector('[data-action="discord-login"]')
  );
}

function renderDiscordUser(user) {
  discordUser = user || null;

  const loginBtn = getLoginButton();

  const displayNameEl = $id("previewDiscordDisplayName");
  const usernameEl = $id("previewDiscordUsername");
  const badgesEl = $id("previewDiscordBadges");

  const avatarTargets = [
    $id("previewDiscordAvatar"),
    $id("loggedInAvatar"),
    $id("userAvatar"),
    $id("profileAvatar")
  ].filter(Boolean);

  const bannerTargets = [
    $id("previewDiscordBanner"),
    $id("loggedInBanner"),
    $id("userBanner"),
    $id("profileBanner")
  ].filter(Boolean);

  if (!user) {
    if (loginBtn) loginBtn.textContent = "Login With Discord";

    if (displayNameEl) displayNameEl.textContent = "Custom RP";
    if (usernameEl) usernameEl.textContent = "customrpc.xyz";

    if (badgesEl) {
      badgesEl.innerHTML = "";
      badgesEl.style.display = "none";
    }

    avatarTargets.forEach((el) => {
      if (el.tagName === "IMG") {
        el.src = "assets/avatar.png";
      }
      el.style.display = "";
    });

    bannerTargets.forEach((el) => {
      if (el.tagName === "IMG") {
        el.src = "";
      } else {
        el.style.backgroundImage = "";
      }
      el.style.display = "";
    });

    return;
  }

  const displayName = user.globalName || user.username;
  const username = `${user.username}`;

  if (loginBtn) loginBtn.textContent = `Logged in as ${user.username}`;

  if (displayNameEl) displayNameEl.textContent = displayName;
  if (usernameEl) usernameEl.textContent = username;
  renderDiscordBadges(user);

  avatarTargets.forEach((el) => {
    if (user.avatar) {
      if (el.tagName === "IMG") {
        el.src = user.avatar;
      } else {
        el.style.backgroundImage = `url("${user.avatar}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
      }
      el.style.display = "";
    } else {
      if (el.tagName === "IMG") el.src = "assets/avatar.png";
      el.style.display = "";
    }
  });

  bannerTargets.forEach((el) => {
    const hasBanner = !!user.banner;
    const hasAccent = user.accentColor !== null && user.accentColor !== undefined;

    if (hasBanner) {
      if (el.tagName === "IMG") {
        el.src = user.banner;
      } else {
        el.style.backgroundImage = `url("${user.banner}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundColor = "";
      }
      el.style.display = "";
      return;
    }

    if (el.tagName === "IMG") {
      el.src = "";
    } else {
      el.style.backgroundImage = "";
      el.style.backgroundColor = hasAccent
        ? `#${user.accentColor.toString(16).padStart(6, "0")}`
        : "";
    }

    el.style.display = "";
  });
}

async function handleDiscordLogin() {
  try {
    if (!window.discordAuth?.login) {
      showToast("Discord auth bridge is not available", "error");
      return;
    }

    await window.discordAuth.login();
  } catch (err) {
    console.error("Discord login failed:", err);
    showToast("Failed to start Discord login", "error");
  }
}

function bindDiscordLoginButton() {
  const loginBtn = getLoginButton();
  if (!loginBtn) return;

  loginBtn.addEventListener("click", async () => {
    await handleDiscordLogin();
  });
}

function bindDiscordAuthEvents() {
  if (!window.discordAuth) return;

  if (window.discordAuth.onUser) {
    window.discordAuth.onUser((user) => {
      renderDiscordUser(user);
      showToast(`Logged in as ${user.username}`, "success", 2500);
    });
  }

  if (window.discordAuth.onError) {
    window.discordAuth.onError((error) => {
      console.error("Discord auth error:", error);
      showToast(error || "Discord login failed", "error");
    });
  }
}

async function loadSavedDiscordUser() {
  try {
    if (!window.discordAuth?.getUser) return;
    const user = await window.discordAuth.getUser();
    if (user) renderDiscordUser(user);
  } catch (err) {
    console.error("Failed to load saved Discord user:", err);
  }
}

/* =========================
   PUBLIC BADGE UI
========================= */
function hasFlag(flags, flag) {
  return (flags & flag) === flag;
}

function getDiscordBadges(user) {
  const flags = Number(user?.publicFlags ?? 0);
  const premiumType = Number(user?.premiumType ?? 0);
  const badges = [];

  if (premiumType === 1 || premiumType === 2 || premiumType === 3) {
    badges.push({
      key: "nitro",
      alt: "Nitro",
      src: "assets/DiscordBadges/NitroBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 0)) {
    badges.push({
      key: "staff",
      alt: "Discord Staff",
      src: "assets/DiscordBadges/StaffBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 1)) {
    badges.push({
      key: "partner",
      alt: "Partnered Server Owner",
      src: "assets/DiscordBadges/PartnerBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 2)) {
    badges.push({
      key: "hypesquad-events",
      alt: "HypeSquad Events",
      src: "assets/DiscordBadges/HypeSquadEventsBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 3)) {
    badges.push({
      key: "bug-hunter-1",
      alt: "Bug Hunter Level 1",
      src: "assets/DiscordBadges/BugHunterBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 6)) {
    badges.push({
      key: "bravery",
      alt: "HypeSquad Bravery",
      src: "assets/DiscordBadges/HypesquadBraveryBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 7)) {
    badges.push({
      key: "brilliance",
      alt: "HypeSquad Brilliance",
      src: "assets/DiscordBadges/HypeSquadBrillianceBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 8)) {
    badges.push({
      key: "balance",
      alt: "HypeSquad Balance",
      src: "assets/DiscordBadges/HypeSquadBalanceBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 9)) {
    badges.push({
      key: "early-supporter",
      alt: "Early Supporter",
      src: "assets/DiscordBadges/EarlySupporterBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 14)) {
    badges.push({
      key: "bug-hunter-2",
      alt: "Bug Hunter Level 2",
      src: "assets/DiscordBadges/GoldenBugHunterBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 17)) {
    badges.push({
      key: "verified-developer",
      alt: "Early Verified Bot Developer",
      src: "assets/DiscordBadges/BotDeveloper.gif"
    });
  }

  if (hasFlag(flags, 1 << 18)) {
    badges.push({
      key: "certified-moderator",
      alt: "Moderator Programs Alumni",
      src: "assets/DiscordBadges/CertifiedModeratorBadge.png"
    });
  }

  if (hasFlag(flags, 1 << 22)) {
    badges.push({
      key: "active-developer",
      alt: "Active Developer",
      src: "assets/DiscordBadges/ActiveDeveloperBadge.png"
    });
  }

  return badges;
}

function renderDiscordBadges(user) {
  const badgesEl = $id("previewDiscordBadges");
  if (!badgesEl) return;

  badgesEl.innerHTML = "";

  if (!user) {
    badgesEl.style.display = "none";
    return;
  }

  const badges = getDiscordBadges(user);

  if (!badges.length) {
    badgesEl.style.display = "none";
    return;
  }

  badgesEl.style.display = "flex";

  badges.forEach((badge) => {
    const img = document.createElement("img");
    img.src = badge.src;
    img.alt = badge.alt;
    img.title = badge.alt;
    badgesEl.appendChild(img);
  });
}

/* =========================
   LIVE PREVIEW
========================= */
function updatePreview() {
  const appName = $id("rpcAppName")?.value || "App name";
  const line1 = $id("rpcLine1")?.value || "";
  const line2 = $id("rpcLine2")?.value || "";

  const b1Label = $id("button1Label")?.value?.trim() || "";
  const b2Label = $id("button2Label")?.value?.trim() || "";
  const b1Url = $id("button1Url")?.value?.trim() || "";
  const b2Url = $id("button2Url")?.value?.trim() || "";

  const appImageUrl = $id("imageUrl")?.value?.trim() || "";
  const smallImage = $id("smallImageUrl")?.value?.trim() || "";

  const previewAppName = $id("previewAppName");
  const previewLine1 = $id("previewLine1");
  const previewLine2 = $id("previewLine2");

  if (previewAppName) previewAppName.textContent = appName;

  if (previewLine1) {
    previewLine1.textContent = line1;
    previewLine1.style.display = line1 ? "block" : "none";
  }

  if (previewLine2) {
    previewLine2.textContent = line2;
    previewLine2.style.display = line2 ? "block" : "none";
  }

  markInvalid("rpcLine1", line1 && !hasMinChars(line1));
  markInvalid("rpcLine2", line2 && !hasMinChars(line2));

  const btnWrap = $id("rpc-buttons-container");
  if (btnWrap) {
    btnWrap.innerHTML = "";

    if (b1Label) {
      const a = document.createElement("a");
      a.className = "rpc-buttons";
      a.textContent = b1Label;
      a.href = b1Url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      btnWrap.appendChild(a);
    }

    if (b2Label) {
      const a = document.createElement("a");
      a.className = "rpc-buttons";
      a.textContent = b2Label;
      a.href = b2Url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      btnWrap.appendChild(a);
    }
  }

  const rpcIcon = $(".rpc-icon");
  if (rpcIcon) {
    const fallback = "assets/avatar.png";

    rpcIcon.referrerPolicy = "no-referrer";

    rpcIcon.onload = () => {
      console.log("[Preview] Large image loaded:", rpcIcon.src);
    };

    rpcIcon.onerror = () => {
      console.error("[Preview] Large image failed:", appImageUrl);
      rpcIcon.onerror = null;
      rpcIcon.src = fallback;
    };

    if (appImageUrl) {
      rpcIcon.src =
        appImageUrl + (appImageUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
    } else {
      rpcIcon.src = fallback;
    }
  }

  const sm = $(".rpc-smallicon");
  if (sm) {
    sm.referrerPolicy = "no-referrer";

    sm.onerror = () => {
      console.error("[Preview] Small image failed:", smallImage);
      sm.style.display = "none";
    };

    if (smallImage) {
      sm.src =
        smallImage + (smallImage.includes("?") ? "&" : "?") + "t=" + Date.now();
      sm.style.display = "block";
    } else {
      sm.style.display = "none";
    }
  }
}

/* =========================
   BUILD ACTIVITY
========================= */
function buildActivity() {
  const buttons = [];

  const b1Label = $id("button1Label")?.value?.trim();
  const b1Url = $id("button1Url")?.value?.trim();
  const b2Label = $id("button2Label")?.value?.trim();
  const b2Url = $id("button2Url")?.value?.trim();

  if (b1Label && b1Url) {
    buttons.push({
      label: b1Label,
      url: b1Url
    });
  }

  if (b2Label && b2Url) {
    buttons.push({
      label: b2Label,
      url: b2Url
    });
  }

  return {
    details: $id("rpcLine1")?.value || "",
    state: $id("rpcLine2")?.value || "",
    largeImageKey: $id("imageUrl")?.value?.trim() || "",
    smallImageKey: $id("smallImageUrl")?.value?.trim() || "",
    buttons
  };
}

/* =========================
   CONNECT / DISCONNECT
========================= */
$id("connectToggleBtn")?.addEventListener("click", async () => {
  if (rpcState === "disconnected") {
    const clientId = $id("appId")?.value?.trim();
    const line1 = $id("rpcLine1")?.value || "";
    const line2 = $id("rpcLine2")?.value || "";

    if (!clientId) {
      showToast("Application ID is required to connect", "error");
      return;
    }

    if (!hasMinChars(line1)) {
      showToast("Line 1 must be at least 2 characters", "error");
      markInvalid("rpcLine1", true);
      return;
    }

    if (!hasMinChars(line2)) {
      showToast("Line 2 must be at least 2 characters", "error");
      markInvalid("rpcLine2", true);
      return;
    }

    try {
      saveSettings();

      rpcState = "connecting";
      updateConnectButton();

      lastActivity = buildActivity();

      await window.rpcApi.start({
        clientId,
        activity: lastActivity
      });
    } catch (err) {
      console.error("Failed to connect RPC:", err);
      rpcState = "disconnected";
      updateConnectButton();
      showToast("Failed to connect RPC", "error");
    }

    return;
  }

  if (rpcState === "connected") {
    try {
      await window.rpcApi.stop();
    } catch (err) {
      console.error("Failed to stop RPC:", err);
      showToast("Failed to stop RPC", "error");
    }
  }
});

/* =========================
   UPDATE
========================= */
$id("updateBtn")?.addEventListener("click", async () => {
  if (rpcState !== "connected") return;

  try {
    saveSettings();
    lastActivity = buildActivity();
    await window.rpcApi.update({ activity: lastActivity });
    showToast("RPC updated", "success", 1800);
  } catch (err) {
    console.error("Failed to update RPC:", err);
    showToast("Failed to update RPC", "error");
  }
});

/* =========================
   INPUT BINDINGS
========================= */
[
  "appId",
  "rpcAppName",
  "rpcLine1",
  "rpcLine2",
  "button1Label",
  "button1Url",
  "button2Label",
  "button2Url",
  "imageUrl",
  "smallImageUrl"
].forEach((id) => {
  $id(id)?.addEventListener("input", () => {
    updatePreview();
    saveSettings();
  });
});

$id("autoConnect")?.addEventListener("change", () => {
  saveSettings();
});

/* =========================
   TITLE BAR
========================= */
$id("close-btn")?.addEventListener("click", () => {
  window.windowControls.hide();
});

/* =========================
   RPC STATUS
========================= */
window.rpcStatus.onStatus((status) => {
  if (status === "connected") rpcState = "connected";
  if (status === "disconnected") rpcState = "disconnected";
  updateConnectButton();
});

/* =========================
   INIT
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  const savedSettings = loadSettings();
  applySettings(savedSettings);

  updatePreview();
  updateConnectButton();

  await loadAppSettingsUI();
  bindAppSettingsUI();

  bindDiscordLoginButton();
  bindDiscordAuthEvents();
  await loadSavedDiscordUser();

  if (savedSettings?.autoConnect) {
    const clientId = $id("appId")?.value?.trim();
    const line1 = $id("rpcLine1")?.value || "";
    const line2 = $id("rpcLine2")?.value || "";

    if (clientId && hasMinChars(line1) && hasMinChars(line2)) {
      try {
        rpcState = "connecting";
        updateConnectButton();

        lastActivity = buildActivity();

        await window.rpcApi.start({
          clientId,
          activity: lastActivity
        });
      } catch (err) {
        console.error("Auto connect failed:", err);
        rpcState = "disconnected";
        updateConnectButton();
        showToast("Auto connect failed", "error");
      }
    }
  }
});
