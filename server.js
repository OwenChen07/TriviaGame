import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT) || 1234;

const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("TriviaGame WebSocket server is running");
});

const wss = new WebSocketServer({ server: httpServer });

const rooms = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUESTIONS_DIR = path.join(__dirname, "questions");

let questionPool = [];

async function loadQuestionPool() {
    const entries = await readdir(QUESTIONS_DIR, { withFileTypes: true });
    const questionFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
        .map((entry) => path.join(QUESTIONS_DIR, entry.name));

    const loaded = [];

    for (const filePath of questionFiles) {
        const fileUrl = pathToFileURL(filePath).href;
        const mod = await import(fileUrl);

        if (Array.isArray(mod.questions)) {
            loaded.push(...mod.questions);
            continue;
        }

        if (mod.question) {
            loaded.push(mod.question);
            continue;
        }

        if (Array.isArray(mod.default)) {
            loaded.push(...mod.default);
            continue;
        }

        if (mod.default) {
            loaded.push(mod.default);
        }
    }

    questionPool = loaded.filter((question) => Array.isArray(question?.items) && question.items.length > 0);
    console.log(`Loaded ${questionPool.length} questions from ${questionFiles.length} files`);
}

function generateCode() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * 26)];
    return rooms[code] ? generateCode() : code;
}

function send(ws, msg) {
    ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
    room.players.forEach((player) => send(player.ws, msg));
}

function normalizedScore(trueRank, playerRank, alpha = 0.8) {
    const n = trueRank.length;
    if (n === 0) return 0;
    if (n === 1) return playerRank[0]?.item === trueRank[0]?.item ? 100 : 0;

    // Map item name -> true index
    const trueIndex = {};
    trueRank.forEach((entry, idx) => {
        trueIndex[entry.item] = idx;
    });

    // 1) Exact position matches
    let exactMatches = 0;
    playerRank.forEach((entry, idx) => {
        if (entry.item === trueRank[idx]?.item) {
            exactMatches++;
        }
    });
    const exactPercent = (exactMatches / n) * 100;

    // 2) Pairwise relative order (slight bonus)
    let correctPairs = 0;
    const totalPairs = n * (n - 1) / 2;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const left = trueIndex[playerRank[i]?.item];
            const right = trueIndex[playerRank[j]?.item];
            if (typeof left === "number" && typeof right === "number" && left < right) {
                correctPairs++;
            }
        }
    }
    const pairwisePercent = (correctPairs / totalPairs) * 100;

    // 3) Combine, giving higher weight to exact matches
    const finalScore = alpha * exactPercent + (1 - alpha) * pairwisePercent;
    return Math.round(finalScore);
}

function shuffle(array) {
  const arr = [...array]; // make a copy

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function startRound(room) {
    if (questionPool.length === 0) {
        broadcast(room, { type: "error", message: "No questions available" });
        room.gameStarted = false;
        room.round = 0;
        return;
    }

    const question = questionPool[Math.floor(Math.random() * questionPool.length)];
    room.question = question;

    const activePlayers = room.players.filter((player) => !player.eliminated);
    const shuffled = shuffle(question.items).slice(0, 5);
    const roundSet = new Set(shuffled.map((item) => item.item));

    room.roundItems = shuffled;
    room.roundCorrect = question.items.filter((item) => roundSet.has(item.item));
    room.awaitingPlayers = new Set(activePlayers.map((player) => player.name));

    console.log(`Round ${room.round} started in room ${room.code}`);

    activePlayers.forEach((player) => {
        send(player.ws, {
            type: "game_started",
            round: room.round,
            prompt: question.prompt,
            items: shuffled,
            timeLimit: 30
        });
    });
}

function resolveRound(room) {
    if (!room.gameStarted) return;

    const activePlayers = room.players.filter((player) => !player.eliminated);
    if (activePlayers.length <= 1) {
        const winner = activePlayers[0]?.name || "";
        const finalResults = room.players
            .map((player) => ({ name: player.name, score: player.score ?? 0 }))
            .sort((a, b) => b.score - a.score);

        broadcast(room, {
            type: "game_over",
            winner,
            results: finalResults,
            correct: room.roundCorrect || []
        });

        room.gameStarted = false;
        room.question = null;
        room.roundItems = [];
        room.roundCorrect = [];
        room.awaitingPlayers = new Set();
        room.round = 0;
        room.players.forEach((player) => {
            player.score = null;
            player.eliminated = false;
        });
        return;
    }

    const ranked = [...activePlayers].sort((a, b) => b.score - a.score);
    const lowestScore = Math.min(...activePlayers.map((player) => player.score ?? 0));
    const lowestPlayers = activePlayers.filter((player) => (player.score ?? 0) === lowestScore);
    const tiedForLowest = lowestPlayers.length > 1;

    if (!tiedForLowest) {
        lowestPlayers[0].eliminated = true;
    }

    const remainingPlayers = room.players
        .filter((player) => !player.eliminated)
        .map((player) => player.name);

    broadcast(room, {
        type: "round_results",
        round: room.round,
        results: ranked.map((player) => ({ name: player.name, score: player.score })),
        eliminated: tiedForLowest ? null : lowestPlayers[0].name,
        tie: tiedForLowest,
        remainingPlayers,
        correct: room.roundCorrect || []
    });

    if (remainingPlayers.length === 1) {
        const winner = remainingPlayers[0];
        broadcast(room, {
            type: "game_over",
            winner,
            results: ranked.map((player) => ({ name: player.name, score: player.score })),
            correct: room.roundCorrect || []
        });

        room.gameStarted = false;
        room.question = null;
        room.roundItems = [];
        room.roundCorrect = [];
        room.awaitingPlayers = new Set();
        room.round = 0;
        room.players.forEach((player) => {
            player.score = null;
            player.eliminated = false;
        });
        return;
    }

    room.round += 1;
    room.awaitingPlayers = new Set();
    setTimeout(() => {
        if (!room.gameStarted) return;
        startRound(room);
    }, 3000);
}

wss.on("connection", (ws) => {
    console.log("Client connected");

    let currentRoom = null;
    let currentPlayer = null;

    ws.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            send(ws, { type: "error", message: "Invalid JSON" });
            return;
        }

        if (msg.type === "create") {
            const code = generateCode();
            currentPlayer = { name: msg.name, ws, score: null, eliminated: false };
            currentRoom = {
                code,
                host: msg.name,
                players: [currentPlayer],
                gameStarted: false,
                question: null,
                round: 0,
                roundItems: [],
                roundCorrect: [],
                awaitingPlayers: new Set(),
            };
            rooms[code] = currentRoom;

            console.log(`Room ${code} created by ${msg.name}`);
            send(ws, { type: "room_created", code });
            broadcast(currentRoom, {
                type: "room_update",
                players: currentRoom.players.map((p) => p.name),
                host: currentRoom.host,
            });
        }

        else if (msg.type === "join") {
            const room = rooms[msg.code];
            if (!room) { send(ws, { type: "error", message: "Room not found" }); return; }
            if (room.gameStarted) { send(ws, { type: "error", message: "Game already started" }); return; }

            currentPlayer = { name: msg.name, ws, score: null, eliminated: false };
            currentRoom = room;
            room.players.push(currentPlayer);

            console.log(`${msg.name} joined room ${msg.code}`);
            send(ws, { type: "joined", code: msg.code });
            broadcast(currentRoom, {
                type: "room_update",
                players: currentRoom.players.map((p) => p.name),
                host: currentRoom.host,
            });
        }

        else if (msg.type === "start_game") {
            if (!currentRoom || currentRoom.host !== currentPlayer.name) return;
            if (currentRoom.players.length < 2) {
                send(ws, { type: "error", message: "Need at least 2 players to start" });
                return;
            }

            currentRoom.gameStarted = true;
            currentRoom.round = 1;
            currentRoom.players.forEach((player) => {
                player.score = null;
                player.eliminated = false;
            });

            console.log(`Game started in room ${currentRoom.code}`);
            startRound(currentRoom);
        }

        else if (msg.type === "answer") {
            if (!currentRoom || !currentPlayer || !currentRoom.question) return;
            if (currentPlayer.eliminated) return;
            if (!currentRoom.awaitingPlayers.has(currentPlayer.name)) return;

            // score the player's answer
            // determine the correct order for only the submitted items
            const submittedItems = Array.isArray(msg.items) ? msg.items : [];
            const correct = currentRoom.roundCorrect;
            
            console.log("Player's answer:", submittedItems);
            console.log("Correct order:", correct);
            const score = normalizedScore(correct, submittedItems);
            currentPlayer.score = score;
            currentRoom.awaitingPlayers.delete(currentPlayer.name);

            console.log(`${currentPlayer.name} answered. Score: ${score}`);

            // once all players have answered, send results
            if (currentRoom.awaitingPlayers.size === 0) {
                resolveRound(currentRoom);
            }
        }
    });

    ws.on("close", () => {
        if (!currentRoom) return;
        currentRoom.players = currentRoom.players.filter((p) => p !== currentPlayer);
        console.log(`${currentPlayer?.name} disconnected`);

        if (currentRoom.players.length === 0) {
            delete rooms[currentRoom.code];
            return;
        }
        if (currentRoom.host === currentPlayer?.name) {
            currentRoom.host = currentRoom.players[0].name;
        }

        if (currentRoom.gameStarted && currentRoom.awaitingPlayers.has(currentPlayer?.name)) {
            currentRoom.awaitingPlayers.delete(currentPlayer.name);
            if (currentRoom.awaitingPlayers.size === 0) {
                resolveRound(currentRoom);
            }
        }

        broadcast(currentRoom, {
            type: "room_update",
            players: currentRoom.players.map((p) => p.name),
            host: currentRoom.host,
        });
    });
});

await loadQuestionPool();
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});