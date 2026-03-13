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
    };

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

    console.log("Discord user:", user);
    console.log("Banner:", user?.banner);

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

  // Nitro
  if (premiumType === 1 || premiumType === 2 || premiumType === 3) {
    badges.push({
      key: "nitro",
      alt: "Nitro",
      src: "assets/DiscordBadges/NitroBadge.png"
    });
  }

  // Public flags / public badges
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

  const appImageUrl = $id("imageUrl")?.value?.trim() || "";
  const smallImage = $id("smallImageUrl")?.value?.trim() || "";

  $id("previewAppName").textContent = appName;

  $id("previewLine1").textContent = line1;
  $id("previewLine1").style.display = line1 ? "block" : "none";

  $id("previewLine2").textContent = line2;
  $id("previewLine2").style.display = line2 ? "block" : "none";

  markInvalid("rpcLine1", line1 && !hasMinChars(line1));
  markInvalid("rpcLine2", line2 && !hasMinChars(line2));

  const btnWrap = $id("rpc-buttons-container");
  if (btnWrap) {
    btnWrap.innerHTML = "";

    if (b1Label) {
      const a = document.createElement("a");
      a.className = "rpc-buttons";
      a.textContent = b1Label;
      btnWrap.appendChild(a);
    }

    if (b2Label) {
      const a = document.createElement("a");
      a.className = "rpc-buttons";
      a.textContent = b2Label;
      btnWrap.appendChild(a);
    }
  }

  const rpcIcon = $(".rpc-icon");
  if (rpcIcon) {
    rpcIcon.src =
      appImageUrl ||
      "https://biq.cloud/wp-content/uploads/2021/02/283-content-management-systems-CMS.gif";
  }

  const sm = $(".rpc-smallicon");
  if (sm) {
    sm.src = smallImage;
    sm.style.display = smallImage ? "block" : "none";
  }
}

/* =========================
   BUILD ACTIVITY
========================= */
function buildActivity() {
  const buttons = [];

  if ($id("button1Label")?.value && $id("button1Url")?.value) {
    buttons.push({
      label: $id("button1Label").value,
      url: $id("button1Url").value
    });
  }

  if ($id("button2Label")?.value && $id("button2Url")?.value) {
    buttons.push({
      label: $id("button2Label").value,
      url: $id("button2Url").value
    });
  }

  return {
    details: $id("rpcLine1")?.value,
    state: $id("rpcLine2")?.value,
    largeImageKey: $id("imageUrl")?.value,
    smallImageKey: $id("smallImageUrl")?.value,
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

    rpcState = "connecting";
    updateConnectButton();

    lastActivity = buildActivity();

    await window.rpcApi.start({
      clientId,
      activity: lastActivity
    });

    return;
  }

  if (rpcState === "connected") {
    await window.rpcApi.stop();
  }
});

/* =========================
   UPDATE
========================= */
$id("updateBtn")?.addEventListener("click", async () => {
  if (rpcState !== "connected") return;

  lastActivity = buildActivity();
  await window.rpcApi.update({ activity: lastActivity });
});

/* =========================
   INPUT BINDINGS
========================= */
[
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
  $id(id)?.addEventListener("input", updatePreview);
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
  updatePreview();
  updateConnectButton();

  bindDiscordLoginButton();
  bindDiscordAuthEvents();
  await loadSavedDiscordUser();
});
