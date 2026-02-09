const http = require("http");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const STAMINA_REGEN = 100;
const MINIGAME_DURATION_MS = 0;
const MINIGAME_STEPS = 5;
const CONTACT_COOLDOWN_MS = 1200;
const MINIGAME_COUNTDOWN_MS = 3000;
const STAMINA_REGEN_DELAY_MS = 3000;
const MINIGAME_COOLDOWN_MS = 5000;
const BOT_PLAYS_MINIGAME = true;
const BOT_MINIGAME_DELAY_MIN = 1200;
const BOT_MINIGAME_DELAY_MAX = 1800;
const CAR = {
  width: 270,
  height: 120,
  speed: 260,
  spawnEveryMs: 5000,
  staminaDrain: 100,
  hitCooldownMs: 1200
};

const MAP = {
  width: 3200,
  height: 1400
};

const PLATFORMS = [
  { x: 0, y: 1050, w: 3200, h: 200 },
  { x: 300, y: 820, w: 500, h: 30 },
  { x: 980, y: 720, w: 420, h: 30 },
  { x: 1600, y: 840, w: 520, h: 30 },
  { x: 2300, y: 700, w: 520, h: 30 },
  { x: 270, y: 540, w: 340, h: 30 },
  { x: 1220, y: 520, w: 340, h: 30 },
  { x: 2100, y: 520, w: 340, h: 30 }
];

const PLAYER = {
  width: 46,
  height: 62,
  speed: 420,
  jump: 780,
  gravity: 1900
};

const BOOST = {
  multiplier: 1.6,
  staminaDrainPerSec: 24
};

const BOT = {
  id: "bot-1",
  name: "Bot Panetta"
};

const LEADERBOARD_TOKEN = process.env.LEADERBOARD_TOKEN || "cambia-questa-chiave";
const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath === "/api/leaderboard") {
    const token = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("token");
    if (!token || token !== LEADERBOARD_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    db.all(
      "SELECT name, bananas_won FROM players ORDER BY bananas_won DESC, name ASC LIMIT 10",
      (err, rows) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "db_error" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows || []));
      }
    );
    return;
  }
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(filePath).replace(/^([\\/\\])+/, "");
  const fullPath = path.join(__dirname, "public", safePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".mp3": "audio/mpeg"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const players = new Map();
let nextSpriteIndex = 1;
const cars = [];
let lastCarSpawn = 0;
const DB_PATH = path.join(__dirname, "data", "bananas.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      client_id TEXT PRIMARY KEY,
      name TEXT,
      bananas_won INTEGER DEFAULT 0
    )
  `);
});

function upsertPlayerStats(clientId, name, bananasWon) {
  if (!clientId) return;
  db.run(
    `INSERT INTO players (client_id, name, bananas_won)
     VALUES (?, ?, ?)
     ON CONFLICT(client_id)
     DO UPDATE SET
       name = excluded.name,
       bananas_won = excluded.bananas_won`,
    [clientId, name || "", bananasWon || 0]
  );
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function spawnPoint() {
  const x = 200 + Math.random() * 2600;
  const y = 300 + Math.random() * 200;
  return { x, y };
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function getState() {
  const list = [];
  for (const p of players.values()) {
    list.push({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      color: p.color,
      stamina: p.stamina,
      boosting: p.boosting,
      hasBanana: p.hasBanana,
      bananasWon: p.bananasWon,
      spriteIndex: p.spriteIndex,
      isBot: !!p.isBot,
      inMinigame: !!p.minigame
    });
  }
  return list;
}

function getCars() {
  return cars.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h
  }));
}

function countHumans() {
  let total = 0;
  for (const p of players.values()) {
    if (!p.isBot) total += 1;
  }
  return total;
}

function resolvePlatforms(p, nextX, nextY) {
  let grounded = false;
  let y = nextY;

  for (const platform of PLATFORMS) {
    const withinX = nextX + PLAYER.width > platform.x && nextX < platform.x + platform.w;
    const wasAbove = p.y + PLAYER.height <= platform.y;
    const willCross = nextY + PLAYER.height >= platform.y;
    if (withinX && wasAbove && willCross) {
      y = platform.y - PLAYER.height;
      grounded = true;
      p.vy = 0;
      break;
    }
  }

  return { y, grounded };
}

function getRandomSequence() {
  const sequence = [];
  for (let i = 0; i < MINIGAME_STEPS; i += 1) {
    sequence.push(Math.random() < 0.5 ? "left" : "right");
  }
  return sequence;
}

function getOpponentId(playerId, minigame) {
  return playerId === minigame.holderId ? minigame.targetId : minigame.holderId;
}

function sendMinigameState(p) {
  if (!p.ws || p.ws.readyState !== WebSocket.OPEN) return;
  if (!p.minigame) {
    send(p.ws, { type: "minigame", active: false });
    return;
  }
  const timeLeft = p.minigame.endTime ? Math.max(0, p.minigame.endTime - Date.now()) : 0;
  const countdownLeft = Math.max(0, p.minigame.startTime - Date.now());
  send(p.ws, {
    type: "minigame",
    active: true,
    sequence: p.minigame.sequence,
    index: p.minigame.index,
    timeLeft,
    countdownLeft
  });
}

function handleMinigameInput(player, dir, silent) {
  if (!player.minigame) return;
  if (Date.now() < player.minigame.startTime - 120) return;
  const expected = player.minigame.sequence[player.minigame.index];
  if (dir !== "left" && dir !== "right") return;
  if (dir === expected) {
    player.minigame.index += 1;
    if (!silent && player.ws) {
      send(player.ws, { type: "minigame_sfx", result: "correct" });
    }
    if (player.minigame.index >= player.minigame.sequence.length) {
      const holderId = player.minigame.holderId;
      const targetId = player.minigame.targetId;
      endMinigame(player.id, holderId, targetId);
    } else {
      sendMinigameState(player);
      const opponentId = getOpponentId(player.id, player.minigame);
      const opponent = players.get(opponentId);
      if (opponent) sendMinigameState(opponent);
    }
  } else {
    if (!silent && player.ws) {
      send(player.ws, { type: "minigame_sfx", result: "wrong" });
    }
    player.minigame.index = 0;
    sendMinigameState(player);
    const opponentId = getOpponentId(player.id, player.minigame);
    const opponent = players.get(opponentId);
    if (opponent) sendMinigameState(opponent);
  }
}

function endMinigame(winnerId, holderId, targetId) {
  const holder = players.get(holderId);
  const target = players.get(targetId);
  const winner = players.get(winnerId);
  if (!holder || !target) return;

  const loserId = winnerId === holderId ? targetId : holderId;
  const loser = players.get(loserId);
  if (loser && loser.ws && loser.ws.readyState === WebSocket.OPEN) {
    send(loser.ws, { type: "minigame_sfx", result: "lose" });
  }
  if (winner && winner.ws && winner.ws.readyState === WebSocket.OPEN) {
    send(winner.ws, { type: "minigame_sfx", result: "win" });
  }

  holder.hasBanana = true;
  target.hasBanana = true;
  if (winner) {
    winner.bananasWon += 1;
    upsertPlayerStats(winner.clientId, winner.name, winner.bananasWon);
  }

  const spawnA = spawnPoint();
  const spawnB = spawnPoint();
  holder.x = spawnA.x;
  holder.y = spawnA.y;
  holder.vx = 0;
  holder.vy = 0;
  holder.grounded = false;
  target.x = spawnB.x;
  target.y = spawnB.y;
  target.vx = 0;
  target.vy = 0;
  target.grounded = false;

  holder.minigame = null;
  target.minigame = null;
  holder.lastMinigameEnd = Date.now();
  target.lastMinigameEnd = Date.now();
  holder.contactCooldownUntil = Date.now() + CONTACT_COOLDOWN_MS;
  target.contactCooldownUntil = Date.now() + CONTACT_COOLDOWN_MS;
  sendMinigameState(holder);
  sendMinigameState(target);
}

function startMinigame(holder, target) {
  const startTime = Date.now() + MINIGAME_COUNTDOWN_MS;
  const session = {
    id: Math.random().toString(36).slice(2, 9),
    sequence: getRandomSequence(),
    index: 0,
    startTime,
    endTime: MINIGAME_DURATION_MS ? startTime + MINIGAME_DURATION_MS : null,
    targetId: target.id,
    holderId: holder.id
  };
  holder.minigame = session;
  target.minigame = { ...session, index: 0 };
  sendMinigameState(holder);
  sendMinigameState(target);
}

function isOverlapping(a, b) {
  return (
    a.x < b.x + PLAYER.width &&
    a.x + PLAYER.width > b.x &&
    a.y < b.y + PLAYER.height &&
    a.y + PLAYER.height > b.y
  );
}

function isOverlappingRect(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function spawnCar() {
  const id = Math.random().toString(36).slice(2, 9);
  cars.push({
    id,
    x: MAP.width + CAR.width,
    y: 1050 - CAR.height + 5,
    w: CAR.width,
    h: CAR.height,
    vx: -CAR.speed
  });
}

function spawnBot() {
  if (players.has(BOT.id)) return;
  const spawn = spawnPoint();
  const bot = {
    id: BOT.id,
    name: BOT.name,
    color: "hsl(30, 80%, 55%)",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    grounded: false,
    jumpsRemaining: 2,
    stamina: 100,
    prevJump: false,
    boosting: false,
    hasBanana: true,
    bananasWon: 0,
    clientId: null,
    lastStaminaUse: Date.now(),
    spriteIndex: 0,
    minigame: null,
    lastMinigameEnd: 0,
    contactCooldownUntil: 0,
    carHitCooldownUntil: 0,
    ws: null,
    isBot: true,
    ai: {
      nextDecision: Date.now() + 800,
      dir: 1,
      wantJump: false,
      wantBoost: false
    },
    input: { left: false, right: true, jump: false, boost: false }
  };
  players.set(bot.id, bot);
}

function updateBotInput(bot) {
  if (!bot.ai) return;
  const now = Date.now();
  if (now >= bot.ai.nextDecision) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    bot.ai.dir = dir;
    bot.ai.wantJump = Math.random() < 0.25;
    bot.ai.wantBoost = Math.random() < 0.35 && bot.stamina > 10;
    bot.ai.nextDecision = now + 900 + Math.random() * 1200;
  }

  bot.input.left = bot.ai.dir < 0;
  bot.input.right = bot.ai.dir > 0;
  bot.input.jump = bot.ai.wantJump && bot.grounded;
  bot.input.boost = bot.ai.wantBoost && bot.stamina > 0;
}

wss.on("connection", (ws) => {
  if (countHumans() >= MAX_PLAYERS) {
    send(ws, { type: "full" });
    ws.close();
    return;
  }

  const id = makeId();
  const spawn = spawnPoint();
  const player = {
    id,
    name: `Panetta-${id.slice(0, 3)}`,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    grounded: false,
    jumpsRemaining: 2,
    stamina: 100,
    prevJump: false,
    boosting: false,
    hasBanana: true,
    bananasWon: 0,
    clientId: null,
    lastStaminaUse: Date.now(),
    spriteIndex: nextSpriteIndex <= 5 ? nextSpriteIndex : 0,
    minigame: null,
    lastMinigameEnd: 0,
    contactCooldownUntil: 0,
    carHitCooldownUntil: 0,
    ws,
    input: { left: false, right: false, jump: false, boost: false }
  };
  if (nextSpriteIndex <= 5) {
    nextSpriteIndex += 1;
  }

  players.set(id, player);
  send(ws, { type: "init", id, map: MAP, platforms: PLATFORMS, maxPlayers: MAX_PLAYERS });
  broadcast({ type: "state", players: getState() });

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (err) {
      return;
    }
    if (data.type === "input") {
      player.input = {
        left: !!data.left,
        right: !!data.right,
        jump: !!data.jump,
        boost: !!data.boost
      };
    }
    if (data.type === "hello" && data.clientId) {
      player.clientId = data.clientId;
      if (typeof data.name === "string" && data.name.trim()) {
        player.name = data.name.trim().slice(0, 16);
      }
      db.get(
        "SELECT name, bananas_won FROM players WHERE client_id = ?",
        [data.clientId],
        (err, row) => {
          if (err) {
            return;
          }
          if (row) {
            player.bananasWon = row.bananas_won || 0;
            if (row.name) {
              player.name = row.name;
            }
            broadcast({ type: "state", players: getState() });
          } else {
            upsertPlayerStats(player.clientId, player.name, player.bananasWon);
            broadcast({ type: "state", players: getState() });
          }
        }
      );
    }
    if (data.type === "minigame_input" && player.minigame) {
      handleMinigameInput(player, data.dir, false);
    }
  });

  ws.on("close", () => {
    upsertPlayerStats(player.clientId, player.name, player.bananasWon);
    players.delete(id);
    broadcast({ type: "state", players: getState() });
  });
});

setInterval(() => {
  spawnBot();
  for (const p of players.values()) {
    if (p.isBot) {
      updateBotInput(p);
    }
    if (p.isBot && p.minigame) {
      p.input.left = false;
      p.input.right = false;
      p.input.jump = false;
      p.input.boost = false;
      p.vx = 0;
      p.boosting = false;
    }
    const input = p.input || {};
    const boosting = input.boost && p.stamina > 0;
    p.boosting = boosting;
    const speed = boosting ? PLAYER.speed * BOOST.multiplier : PLAYER.speed;
    if (input.left === input.right) {
      p.vx *= 0.82;
    } else if (input.left) {
      p.vx = -speed;
    } else if (input.right) {
      p.vx = speed;
    }

    if (p.grounded) {
      p.jumpsRemaining = 2;
    }
    const isDoubleJump = p.jumpsRemaining === 1 && !p.grounded;
    const jumpPressed = input.jump && !p.prevJump;
    p.prevJump = input.jump;
    if (jumpPressed && p.jumpsRemaining > 0) {
      if (isDoubleJump && p.stamina < 10) {
        // Not enough stamina for the double jump.
      } else {
      p.vy = -PLAYER.jump;
      p.grounded = false;
      p.jumpsRemaining -= 1;
      if (isDoubleJump) {
        p.stamina = Math.max(0, p.stamina - 10);
        p.lastStaminaUse = Date.now();
      }
      }
    }

    p.vy += PLAYER.gravity * DT;
    let nextX = p.x + p.vx * DT;
    let nextY = p.y + p.vy * DT;

    if (nextX < 0) {
      nextX = MAP.width - PLAYER.width;
    } else if (nextX > MAP.width - PLAYER.width) {
      nextX = 0;
    }
    nextY = Math.min(MAP.height - PLAYER.height, nextY);

    const resolved = resolvePlatforms(p, nextX, nextY);
    p.x = nextX;
    p.y = resolved.y;
    p.grounded = resolved.grounded;
    if (boosting) {
      p.stamina = Math.max(0, p.stamina - BOOST.staminaDrainPerSec * DT);
      p.lastStaminaUse = Date.now();
    } else {
      if (Date.now() - p.lastStaminaUse >= STAMINA_REGEN_DELAY_MS) {
        p.stamina = Math.min(100, p.stamina + DT * STAMINA_REGEN);
      }
    }

    if (p.minigame && p.minigame.endTime && Date.now() > p.minigame.endTime) {
      const holderId = p.minigame.holderId;
      const targetId = p.minigame.targetId;
      endMinigame(holderId, holderId, targetId);
    }

    if (p.minigame) {
      sendMinigameState(p);
      if (BOT_PLAYS_MINIGAME && p.isBot && Date.now() >= p.minigame.startTime) {
        if (!p.minigame.nextInputAt || Date.now() >= p.minigame.nextInputAt) {
          const expected = p.minigame.sequence[p.minigame.index];
          handleMinigameInput(p, expected, true);
          const delay = BOT_MINIGAME_DELAY_MIN + Math.random() * (BOT_MINIGAME_DELAY_MAX - BOT_MINIGAME_DELAY_MIN);
          if (p.minigame) {
            p.minigame.nextInputAt = Date.now() + delay;
          }
        }
      }
    }
  }

  if (Date.now() - lastCarSpawn >= CAR.spawnEveryMs) {
    spawnCar();
    lastCarSpawn = Date.now();
  }
  for (let i = cars.length - 1; i >= 0; i -= 1) {
    const car = cars[i];
    car.x += car.vx * DT;
    if (car.x < -CAR.width * 2) {
      cars.splice(i, 1);
      continue;
    }
    for (const p of players.values()) {
      if (p.minigame) continue;
      if (Date.now() < p.carHitCooldownUntil) continue;
      const hit = isOverlappingRect(
        { x: p.x, y: p.y, w: PLAYER.width, h: PLAYER.height },
        { x: car.x, y: car.y, w: car.w, h: car.h }
      );
      if (hit) {
        p.stamina = Math.max(0, p.stamina - CAR.staminaDrain);
        p.lastStaminaUse = Date.now();
        p.carHitCooldownUntil = Date.now() + CAR.hitCooldownMs;
      }
    }
  }

  const list = Array.from(players.values());
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const now = Date.now();
      if (a.minigame || b.minigame) continue;
      if (now - a.lastMinigameEnd < MINIGAME_COOLDOWN_MS) continue;
      if (now - b.lastMinigameEnd < MINIGAME_COOLDOWN_MS) continue;
      if (now < a.contactCooldownUntil || now < b.contactCooldownUntil) continue;
      if (!isOverlapping(a, b)) continue;
      if (a.hasBanana && !b.hasBanana) {
        startMinigame(a, b);
      } else if (b.hasBanana && !a.hasBanana) {
        startMinigame(b, a);
      } else if (a.hasBanana && b.hasBanana) {
        const pick = Math.random() < 0.5 ? a : b;
        const other = pick === a ? b : a;
        startMinigame(pick, other);
      }
      if (a.minigame || b.minigame) {
        break;
      }
    }
  }

  broadcast({ type: "state", players: getState(), cars: getCars() });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
