const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const staminaWidget = document.getElementById("stamina-widget");
const bananaCountEl = document.getElementById("banana-count");
const leaderboardList = document.getElementById("leaderboard-list");
const loginEl = document.getElementById("login");
const nameInput = document.getElementById("name-input");
const nameSubmit = document.getElementById("name-submit");
const minimap = document.getElementById("minimap");
const minimapCtx = minimap ? minimap.getContext("2d") : null;
const debugEl = document.getElementById("debug");
const bgm = document.getElementById("bgm");
const menu = document.getElementById("menu");
const menuToggle = document.getElementById("menu-toggle");
const menuClose = document.getElementById("menu-close");
const volumeSlider = document.getElementById("volume");
const muteToggle = document.getElementById("mute");
const leftBtn = document.getElementById("left");
const rightBtn = document.getElementById("right");
const jumpBtn = document.getElementById("jump");
const boostBtn = document.getElementById("boost");
const minigameEl = document.getElementById("minigame");
const minigameSeqEl = document.getElementById("minigame-seq");
const minigameCountEl = document.getElementById("minigame-count");
const minigameTimerEl = document.getElementById("minigame-timer");
const minigameResultEl = document.getElementById("minigame-result");
const sfxCorrect = document.getElementById("sfx-correct");
const sfxWrong = document.getElementById("sfx-wrong");
const sfxBoost = document.getElementById("sfx-boost");
const sfxNoBoost = document.getElementById("sfx-noboost");
const sfxRecharge1 = document.getElementById("sfx-recharge-1");
const sfxRecharge2 = document.getElementById("sfx-recharge-2");
const sfxCountdown = document.getElementById("sfx-countdown");
const sfxWin1 = document.getElementById("sfx-win-1");
const sfxWin2 = document.getElementById("sfx-win-2");
const sfxWin3 = document.getElementById("sfx-win-3");
const sfxWins = [sfxWin1, sfxWin2, sfxWin3].filter(Boolean);
let menuOpen = false;
let audioUnlocked = false;
let lastStaminaStep = null;
let rechargeToggle = false;
const debugEnabled = new URLSearchParams(window.location.search).has("debug");
const debugLines = [];
let lastDebugInput = "";
let lastDebugStamina = null;
let lastDebugMinigameActive = null;
let lastDebugMinigameIndex = null;
let lastDebugCountdown = null;
let lastDebugSnapshot = 0;
if (muteToggle) {
  muteToggle.checked = true;
}

function debugLog(message) {
  if (!debugEnabled) return;
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  debugLines.push(line);
  if (debugLines.length > 8) {
    debugLines.shift();
  }
  if (debugEl) {
    debugEl.textContent = debugLines.join("\n");
    debugEl.classList.remove("debug-hidden");
    debugEl.setAttribute("aria-hidden", "false");
  }
  console.log(line);
}

if (!debugEnabled && debugEl) {
  debugEl.classList.add("debug-hidden");
  debugEl.setAttribute("aria-hidden", "true");
}

const sprite = new Image();
sprite.src = "_Skins/monkey.png";
let spriteReady = false;
let spriteSize = { w: 90, h: 90 };
sprite.onload = () => {
  spriteReady = true;
  const ratio = sprite.naturalWidth / sprite.naturalHeight;
  spriteSize.h = 90;
  spriteSize.w = Math.round(spriteSize.h * ratio);
};

const playerSprites = {};
const playerSpriteSizes = {};
for (let i = 1; i <= 5; i += 1) {
  const img = new Image();
  img.src = `_Skins/monkey_0${i}.png`;
  img.onload = () => {
    const ratio = img.naturalWidth / img.naturalHeight;
    playerSpriteSizes[i] = { h: 90, w: Math.round(90 * ratio) };
  };
  playerSprites[i] = img;
}

const boostPlayerSprite = new Image();
boostPlayerSprite.src = "_Assets/monkey_boost.png";
let boostPlayerReady = false;
let boostPlayerSize = { w: 90, h: 90 };
boostPlayerSprite.onload = () => {
  boostPlayerReady = true;
  const ratio = boostPlayerSprite.naturalWidth / boostPlayerSprite.naturalHeight;
  boostPlayerSize.h = 90;
  boostPlayerSize.w = Math.round(boostPlayerSize.h * ratio);
};

const bananaSprite = new Image();
bananaSprite.src = "_Assets/banana_testa.png";
let bananaReady = false;
let bananaSize = { w: 24, h: 24 };
bananaSprite.onload = () => {
  bananaReady = true;
  const ratio = bananaSprite.naturalWidth / bananaSprite.naturalHeight;
  bananaSize.h = 24;
  bananaSize.w = Math.round(bananaSize.h * ratio);
};

const carSprite = new Image();
carSprite.src = "_Assets/auto_01.png";
let carReady = false;
carSprite.onload = () => {
  carReady = true;
};

const staminaFrames = {};
for (let value = 0; value <= 100; value += 10) {
  const img = new Image();
  img.src = `_Assets/stamina_${value}.png`;
  staminaFrames[value] = img;
}

let socket;
let myId = null;
let clientId = null;
let playerName = null;
let map = { width: 3200, height: 1400 };
let platforms = [];
let players = [];
let cars = [];
let input = { left: false, right: false, jump: false, boost: false };
let minigame = { active: false, sequence: [], index: 0, timeLeft: 0, countdownLeft: 0 };
let minigamePrevIndex = 0;
let minigamePrevSeq = "";
let lastCountdownTick = null;
let minigameFlash = null;
let minigameFlashUntil = 0;
let minigameResultUntil = 0;
let minigameRevealAt = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

window.addEventListener("error", (event) => {
  debugLog(`error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  debugLog(`promise: ${event.reason}`);
});

function connect() {
  const wsUrl = window.__WS_URL__;
  if (wsUrl && wsUrl.startsWith("ws")) {
    socket = new WebSocket(wsUrl);
  } else {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}`);
  }

  if (!clientId) {
    clientId = sessionStorage.getItem("rbm_client_id");
    if (!clientId) {
      clientId = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem("rbm_client_id", clientId);
    }
  }
  if (!playerName) {
    playerName = localStorage.getItem("rbm_name");
  }

  socket.addEventListener("open", () => {
    debugLog("ws open");
    debugLog(`clientId ${clientId || "none"}`);
    if (playerName) {
      socket.send(JSON.stringify({ type: "hello", clientId, name: playerName }));
    }
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== "state") {
      debugLog(`ws ${data.type}`);
    }
    if (data.type === "init") {
      myId = data.id;
      map = data.map;
      platforms = data.platforms;
    }
    if (data.type === "state") {
      players = data.players || [];
      cars = data.cars || [];
      updateStamina();
      updateBananaScore();
      updateLeaderboard();
      if (debugEnabled && performance.now() - lastDebugSnapshot > 1000) {
        const me = players.find((p) => p.id === myId);
        const stamina = me ? Math.round(me.stamina || 0) : "n/a";
        const bananas = me ? me.bananasWon || 0 : "n/a";
        debugLog(`state players=${players.length} stamina=${stamina} bananas=${bananas}`);
        lastDebugSnapshot = performance.now();
      }
    }
    if (data.type === "full") {
      alert("Stanza piena (5 giocatori).");
    }
    if (data.type === "minigame") {
      minigame.active = !!data.active;
      minigame.sequence = data.sequence || [];
      minigame.index = data.index || 0;
      minigame.timeLeft = data.timeLeft || 0;
      minigame.countdownLeft = data.countdownLeft || 0;
      renderMinigame();
    }
    if (data.type === "minigame_sfx") {
      if (data.result === "correct" && sfxCorrect) {
        playSfx(sfxCorrect);
        minigameFlash = "correct";
        minigameFlashUntil = Date.now() + 300;
      }
      if (data.result === "wrong" && sfxWrong) {
        playSfx(sfxWrong);
        minigameFlash = "wrong";
        minigameFlashUntil = Date.now() + 300;
      }
      if (data.result === "win") {
        const pick = sfxWins.length
          ? sfxWins[Math.floor(Math.random() * sfxWins.length)]
          : null;
        playSfx(pick);
        showMinigameResult("Hai vinto!");
      }
      if (data.result === "lose") {
        showMinigameResult("Hai perso!");
      }
    }
  });

  socket.addEventListener("error", () => {
    debugLog("ws error");
  });

  socket.addEventListener("close", () => {
    debugLog("ws close");
    setTimeout(connect, 1500);
  });
}

connect();

function playSfx(sfx, volume) {
  if (!sfx) return;
  sfx.muted = false;
  sfx.volume = typeof volume === "number" ? volume : 0.8;
  sfx.currentTime = 0;
  sfx.play().catch(() => {});
}

function startBoostSfx() {
  if (!sfxBoost) return;
  sfxBoost.loop = true;
  sfxBoost.muted = false;
  sfxBoost.volume = 0.8;
  if (sfxBoost.paused) {
    sfxBoost.currentTime = 0;
    sfxBoost.play().catch(() => {});
  }
}

function stopBoostSfx() {
  if (!sfxBoost) return;
  sfxBoost.pause();
  sfxBoost.currentTime = 0;
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  debugLog("audio unlocked");

  if (bgm) {
    if (volumeSlider) {
      bgm.volume = Number(volumeSlider.value || 40) / 100;
    } else {
      bgm.volume = 0.4;
    }
    if (muteToggle) {
      bgm.muted = muteToggle.checked;
    } else {
      bgm.muted = true;
    }
    bgm.load();
    bgm.play().catch(() => {});
  }

  [sfxCorrect, sfxWrong].forEach((sfx) => {
    if (!sfx) return;
    sfx.muted = true;
    sfx.volume = 0;
    sfx.play().then(() => {
      sfx.pause();
      sfx.currentTime = 0;
      sfx.muted = false;
      sfx.volume = 1;
    }).catch(() => {});
  });
  if (sfxBoost) {
    sfxBoost.muted = true;
    sfxBoost.volume = 0;
    sfxBoost.play().then(() => {
      sfxBoost.pause();
      sfxBoost.currentTime = 0;
      sfxBoost.muted = false;
      sfxBoost.volume = 1;
    }).catch(() => {});
  }
  if (sfxNoBoost) {
    sfxNoBoost.muted = true;
    sfxNoBoost.volume = 0;
    sfxNoBoost.play().then(() => {
      sfxNoBoost.pause();
      sfxNoBoost.currentTime = 0;
      sfxNoBoost.muted = false;
      sfxNoBoost.volume = 1;
    }).catch(() => {});
  }
  [sfxRecharge1, sfxRecharge2, sfxCountdown, ...sfxWins].forEach((sfx) => {
    if (!sfx) return;
    sfx.muted = true;
    sfx.volume = 0;
    sfx.play().then(() => {
      sfx.pause();
      sfx.currentTime = 0;
      sfx.muted = false;
      sfx.volume = 1;
    }).catch(() => {});
  });
}

window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

function updateStamina() {
  if (!staminaWidget) return;
  const me = players.find((p) => p.id === myId);
  if (!me || typeof me.stamina !== "number") {
    staminaWidget.style.backgroundImage = "url('_Assets/stamina_0.png')";
    return;
  }
  const value = Math.max(0, Math.min(100, me.stamina));
  if (debugEnabled && lastDebugStamina !== value) {
    debugLog(`stamina ${Math.round(value)}`);
    lastDebugStamina = value;
  }
  const step = Math.floor(value / 10) * 10;
  const frame = staminaFrames[step];
  if (frame && frame.complete) {
    staminaWidget.style.backgroundImage = `url('_Assets/stamina_${step}.png')`;
  }
  if (lastStaminaStep === null) {
    lastStaminaStep = step;
  } else if (step > lastStaminaStep) {
    rechargeToggle = !rechargeToggle;
    playSfx(rechargeToggle ? sfxRecharge1 : sfxRecharge2, 0.3);
    lastStaminaStep = step;
  } else if (step < lastStaminaStep) {
    lastStaminaStep = step;
  }

  if (input.boost && value <= 0) {
    stopBoostSfx();
  }
}

function updateBananaScore() {
  if (!bananaCountEl) return;
  const me = players.find((p) => p.id === myId);
  if (!me || typeof me.bananasWon !== "number") {
    bananaCountEl.textContent = "0";
    return;
  }
  bananaCountEl.textContent = `${me.bananasWon}`;
}

function getMyStamina() {
  const me = players.find((p) => p.id === myId);
  return me && typeof me.stamina === "number" ? me.stamina : 0;
}

function updateLeaderboard() {
  if (!leaderboardList) return;
  const colorForName = (name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 45%)`;
  };
  const list = players
    .slice()
    .sort((a, b) => (b.bananasWon || 0) - (a.bananasWon || 0))
    .slice(0, 5);
  leaderboardList.innerHTML = list
    .map((p, idx) => {
      const name = p.name || `Player ${idx + 1}`;
      const score = p.bananasWon || 0;
      const color = colorForName(name);
      return `<div class="leaderboard-row"><span class="leaderboard-name" style="color:${color}">${name}</span><span>${score}</span></div>`;
    })
    .join("");
}

function showLogin(show) {
  if (!loginEl) return;
  loginEl.classList.toggle("login-hidden", !show);
  loginEl.setAttribute("aria-hidden", show ? "false" : "true");
  if (show && nameInput) {
    nameInput.focus();
  }
}

function submitName() {
  const value = nameInput ? nameInput.value.trim() : "";
  if (!value) return;
  playerName = value.slice(0, 16);
  localStorage.setItem("rbm_name", playerName);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "hello", clientId, name: playerName }));
  }
  showLogin(false);
}

if (nameSubmit) {
  nameSubmit.addEventListener("click", submitName);
}

if (nameInput) {
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitName();
    }
  });
}

if (!playerName) {
  showLogin(true);
}

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (debugEnabled) {
    const state = `${input.left ? 1 : 0}${input.right ? 1 : 0}${input.jump ? 1 : 0}${input.boost ? 1 : 0}`;
    if (state !== lastDebugInput) {
      debugLog(`input L${input.left ? 1 : 0} R${input.right ? 1 : 0} J${input.jump ? 1 : 0} B${input.boost ? 1 : 0}`);
      lastDebugInput = state;
    }
  }
  socket.send(JSON.stringify({
    type: "input",
    left: input.left,
    right: input.right,
    jump: input.jump,
    boost: input.boost
  }));
}

function sendMinigameInput(dir) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  debugLog(`minigame input ${dir}`);
  socket.send(JSON.stringify({
    type: "minigame_input",
    dir
  }));
}

setInterval(() => {
  sendInput();
}, 80);

function toggleMenu(nextState) {
  menuOpen = typeof nextState === "boolean" ? nextState : !menuOpen;
  if (menu) {
    menu.classList.toggle("menu-hidden", !menuOpen);
    menu.setAttribute("aria-hidden", menuOpen ? "false" : "true");
  }
  if (menuOpen) {
    input.left = false;
    input.right = false;
    input.jump = false;
    input.boost = false;
  }
  sendInput();
}

if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    toggleMenu();
  });
}
if (menuClose) {
  menuClose.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu(false);
  });
}
if (menu) {
  menu.addEventListener("click", (event) => {
    if (event.target === menu) {
      toggleMenu(false);
    }
  });
}

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    if (bgm) {
      bgm.volume = Number(volumeSlider.value || 40) / 100;
    }
  });
}
if (muteToggle) {
  muteToggle.addEventListener("change", () => {
    if (bgm) {
      bgm.muted = muteToggle.checked;
    }
  });
}

if (menu) {
  menuOpen = false;
  menu.classList.add("menu-hidden");
  menu.setAttribute("aria-hidden", "true");
}

function setButton(btn, key, pressed) {
  if (!btn) return;
  btn.classList.toggle("active", pressed);
  if (key === "boost" && pressed) {
    if (getMyStamina() > 0) {
      startBoostSfx();
    } else {
      playSfx(sfxNoBoost);
    }
  }
  if (key === "boost" && !pressed) {
    stopBoostSfx();
  }
  input[key] = pressed;
  if (!menuOpen) {
    sendInput();
  }
}

function setupButton(btn, key) {
  if (!btn) return;
  btn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    btn.setPointerCapture(event.pointerId);
    if (minigame.active && minigame.countdownLeft <= 0 && (key === "left" || key === "right")) {
      sendMinigameInput(key);
      return;
    }
    setButton(btn, key, true);
  });
  btn.addEventListener("pointerup", (event) => {
    event.preventDefault();
    setButton(btn, key, false);
  });
  btn.addEventListener("pointercancel", () => setButton(btn, key, false));
}

setupButton(leftBtn, "left");
setupButton(rightBtn, "right");
setupButton(jumpBtn, "jump");
setupButton(boostBtn, "boost");

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" || event.code === "KeyM") {
    toggleMenu();
    return;
  }
  if (minigame.active) {
    if (minigame.countdownLeft > 0) return;
    if (event.code === "ArrowLeft" || event.code === "ArrowRight" || event.code === "KeyA" || event.code === "KeyD") {
      sendMinigameInput(event.code === "ArrowLeft" || event.code === "KeyA" ? "left" : "right");
    }
    return;
  }
  if (event.code === "KeyA" || event.code === "ArrowLeft") input.left = true;
  if (event.code === "KeyD" || event.code === "ArrowRight") input.right = true;
  if (event.code === "KeyW" || event.code === "ArrowUp" || event.code === "Space") input.jump = true;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    if (!input.boost) {
      if (getMyStamina() > 0) {
        startBoostSfx();
      } else {
        playSfx(sfxNoBoost);
      }
    }
    input.boost = true;
  }
  if (!menuOpen) {
    sendInput();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "KeyA" || event.code === "ArrowLeft") input.left = false;
  if (event.code === "KeyD" || event.code === "ArrowRight") input.right = false;
  if (event.code === "KeyW" || event.code === "ArrowUp" || event.code === "Space") input.jump = false;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") input.boost = false;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    stopBoostSfx();
  }
  if (!menuOpen) {
    sendInput();
  }
});

function resetInput() {
  input.left = false;
  input.right = false;
  input.jump = false;
  input.boost = false;
  sendInput();
}

window.addEventListener("blur", resetInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetInput();
  }
});

function getCamera() {
  const me = players.find((p) => p.id === myId);
  if (!me) return { x: 0, y: 0 };
  const targetX = me.x - window.innerWidth / 2 + 23;
  const targetY = me.y - window.innerHeight / 2 + 30;
  return {
    x: Math.max(0, Math.min(map.width - window.innerWidth, targetX)),
    y: Math.max(0, Math.min(map.height - window.innerHeight, targetY))
  };
}

function seedFromId(id) {
  if (!id) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function drawBackground(camera) {
  const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grd.addColorStop(0, "#f0c692");
  grd.addColorStop(1, "#f3eee7");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMap(camera) {
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  ctx.fillStyle = "#f0a165";
  ctx.fillRect(0, 1050, map.width, 350);

  ctx.fillStyle = "#1f1d2b";
  platforms.forEach((p) => {
    ctx.fillRect(p.x, p.y, p.w, p.h);
  });

  ctx.fillStyle = "#aa2e2b";
  ctx.globalAlpha = 0.3;
  ctx.fillRect(0, 1200, map.width, 200);
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawCars(camera) {
  if (!cars.length) return;
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  for (const car of cars) {
    if (carReady) {
      ctx.drawImage(carSprite, car.x, car.y, car.w, car.h);
    } else {
      ctx.fillStyle = "#e0633b";
      ctx.fillRect(car.x, car.y, car.w, car.h);
    }
  }
  ctx.restore();
}

function drawPlayer(p, camera) {
  if (p.isBot && p.inMinigame) return;
  const drawX = p.x - camera.x;
  const drawY = p.y - camera.y;
  const facingRight = (p.vx || 0) < 0;
  const moveDir = p.vx === 0 ? 1 : Math.sign(p.vx);
  const now = performance.now();
  const seed = seedFromId(p.id || "");
  const bob = Math.sin(now * 0.01 + seed) * 1.2;

  ctx.save();
  ctx.translate(drawX, drawY + bob);

  if (p.boosting) {
    drawBoostFlame(moveDir);
  }
  const playerSprite = p.spriteIndex && playerSprites[p.spriteIndex];
  const playerSpriteSize = p.spriteIndex && playerSpriteSizes[p.spriteIndex];
  const usingPlayerSprite = playerSprite && playerSprite.complete;
  if (spriteReady || usingPlayerSprite) {
    if (!facingRight) {
      ctx.scale(-1, 1);
    }
    const activeSize = usingPlayerSprite ? playerSpriteSize : spriteSize;
    const activeSprite = usingPlayerSprite ? playerSprite : sprite;
    const offsetX = facingRight ? -14 : -14 - activeSize.w;
    ctx.drawImage(activeSprite, offsetX, -26, activeSize.w, activeSize.h);
    if (p.boosting && boostPlayerReady) {
      ctx.drawImage(boostPlayerSprite, offsetX, -26, activeSize.w, activeSize.h);
    }
    if (p.hasBanana) {
      drawBanana(offsetX, activeSize.w);
    }
  } else {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(14, 50, 12, 0, Math.PI * 2);
    ctx.arc(36, 50, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#333";
    ctx.fillRect(12, 38, 26, 4);

    ctx.fillStyle = p.color;
    ctx.fillRect(18, 12, 20, 30);
    ctx.fillRect(16, 6, 24, 10);
    if (p.hasBanana) {
      drawBanana(-14, 90);
    }
  }

  ctx.restore();
}

function drawBanana(offsetX, baseWidth) {
  if (!bananaReady) return;
  ctx.save();
  const x = Math.round(offsetX + baseWidth * 0.15 + 25);
  const y = 0;
  ctx.drawImage(bananaSprite, x, y, bananaSize.w, bananaSize.h);
  ctx.restore();
}

function renderMinigame() {
  if (!minigameEl || !minigameSeqEl || !minigameTimerEl || !minigameCountEl) return;
  if (!minigame.active) {
    if (debugEnabled && lastDebugMinigameActive !== false) {
      debugLog("minigame off");
      lastDebugMinigameActive = false;
    }
    minigameEl.classList.add("minigame-hidden");
    minigameEl.setAttribute("aria-hidden", "true");
    minigamePrevIndex = 0;
    minigamePrevSeq = "";
    return;
  }
  input.left = false;
  input.right = false;
  input.jump = false;
  input.boost = false;
  sendInput();
  minigameEl.classList.remove("minigame-hidden");
  minigameEl.setAttribute("aria-hidden", "false");
  if (debugEnabled && lastDebugMinigameActive !== true) {
    debugLog("minigame on");
    lastDebugMinigameActive = true;
  }
  const arrow = (dir) => (dir === "left" ? "&larr;" : "&rarr;");
  const seqKey = minigame.sequence.join(",");
  if (minigame.countdownLeft > 0) {
    minigameSeqEl.innerHTML = "";
    const tick = Math.ceil(minigame.countdownLeft / 1000);
    if (tick !== lastCountdownTick) {
      lastCountdownTick = tick;
      playSfx(sfxCountdown);
      if (debugEnabled && lastDebugCountdown !== tick) {
        debugLog(`countdown ${tick}`);
        lastDebugCountdown = tick;
      }
    }
  } else {
    if (lastCountdownTick !== null) {
      lastCountdownTick = null;
      minigameRevealAt = Date.now() + 220;
    }
    const current = minigame.sequence[minigame.index];
    const pop = minigame.index !== minigamePrevIndex ? "pop" : "";
    const hit = minigame.index > minigamePrevIndex ? "hit" : "";
    if (minigame.index !== minigamePrevIndex) {
      minigameRevealAt = Date.now() + 180;
    }
    if (Date.now() < minigameRevealAt) {
      minigameSeqEl.innerHTML = "";
    } else {
      const flash = Date.now() < minigameFlashUntil ? `flash-${minigameFlash}` : "";
      minigameSeqEl.innerHTML = `<span class="${pop} ${hit} blink ${flash}" data-index="${minigame.index}">${arrow(current)}</span>`;
    }
    if (debugEnabled && lastDebugMinigameIndex !== minigame.index) {
      debugLog(`minigame step ${minigame.index + 1}/${minigame.sequence.length}`);
      lastDebugMinigameIndex = minigame.index;
    }
  }
  if (minigame.countdownLeft > 0) {
    minigameCountEl.textContent = `Start: ${Math.ceil(minigame.countdownLeft / 1000)}`;
  } else {
    minigameCountEl.textContent = "";
    lastCountdownTick = null;
  }
  minigameTimerEl.textContent = "";

  if (seqKey !== minigamePrevSeq) {
    minigamePrevSeq = seqKey;
    minigamePrevIndex = 0;
    minigameRevealAt = Date.now() + 220;
  }
  if (minigame.index !== minigamePrevIndex) {
    minigamePrevIndex = minigame.index;
  }
}

function showMinigameResult(message) {
  if (!minigameResultEl) return;
  minigameResultEl.textContent = message;
  minigameResultEl.classList.remove("minigame-result-hidden");
  minigameResultUntil = Date.now() + 1200;
}

function drawBoostFlame() {
  return;
}

function draw() {
  if (minigameResultEl && minigameResultUntil && Date.now() > minigameResultUntil) {
    minigameResultEl.classList.add("minigame-result-hidden");
    minigameResultUntil = 0;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const camera = getCamera();
  drawBackground(camera);
  drawMap(camera);
  drawCars(camera);
  players.forEach((p) => drawPlayer(p, camera));
  drawMinimap();
  requestAnimationFrame(draw);
}

draw();

function drawMinimap() {
  if (!minimapCtx || !map) return;
  const w = minimap.width;
  const h = minimap.height;
  minimapCtx.clearRect(0, 0, w, h);
  minimapCtx.fillStyle = "#f3eee7";
  minimapCtx.fillRect(0, 0, w, h);

  minimapCtx.strokeStyle = "#2a1f1b";
  minimapCtx.lineWidth = 2;
  minimapCtx.strokeRect(2, 2, w - 4, h - 4);

  const scaleX = (w - 8) / map.width;
  const scaleY = (h - 8) / map.height;
  minimapCtx.fillStyle = "#3a3448";
  platforms.forEach((p) => {
    const px = 4 + p.x * scaleX;
    const py = 4 + p.y * scaleY;
    const pw = Math.max(2, p.w * scaleX);
    const ph = Math.max(2, p.h * scaleY);
    minimapCtx.fillRect(px, py, pw, ph);
  });
  for (const p of players) {
    if (p.isBot && p.inMinigame) continue;
    const x = 4 + p.x * scaleX;
    const y = 4 + p.y * scaleY;
    const isMe = p.id === myId;
    minimapCtx.fillStyle = isMe ? "#d86e4a" : "#1f1d2b";
    minimapCtx.beginPath();
    minimapCtx.arc(x, y, isMe ? 3 : 2, 0, Math.PI * 2);
    minimapCtx.fill();
  }
}




