import { useState, useRef } from "react";

type Status = "idle" | "lobby" | "playing" | "waiting" | "round_results" | "eliminated" | "finished";

interface Result {
  name: string;
  score: number;
  lives: number;
  eliminated?: boolean;
}

interface RankedItem {
  item: string;
  number: number;
  image?: string | null;
}

const WS_URL = process.env.REACT_APP_WS_URL ||
  (window.location.hostname === "localhost"
    ? "ws://localhost:1234"
    : "wss://triviagame-meli.onrender.com");

export default function App() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [players, setPlayers] = useState<string[]>([]);
  const [host, setHost] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [winner, setWinner] = useState("");
  const [round, setRound] = useState(1);
  const [lifeLostPlayers, setLifeLostPlayers] = useState<string[]>([]);
  const [eliminatedPlayers, setEliminatedPlayers] = useState<string[]>([]);
  const [remainingPlayers, setRemainingPlayers] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<RankedItem[]>([]);
  const [submittedOrder, setSubmittedOrder] = useState<RankedItem[]>([]);
  const [correctOrder, setCorrectOrder] = useState<RankedItem[]>([]);
  const [timeLeft, setTimeLeft] = useState(30);
  const [dragIndex, setDragIndex] = useState<number | null>(null); // index of the item being dragged

  const ws = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // starts the 30 second countdown — when it hits 0, auto submit whatever order the player has
  const startTimer = (seconds: number, currentItems: RankedItem[]) => {
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          submitAnswer(currentItems);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const connect = (onOpen: () => void) => {
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = onOpen;
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "error") { setError(msg.message); return; }
      if (msg.type === "room_created") { setRoomCode(msg.code); setStatus("lobby"); }
      if (msg.type === "joined") { setRoomCode(msg.code); setStatus("lobby"); }
      if (msg.type === "room_update") { setPlayers(msg.players); setHost(msg.host); }

      if (msg.type === "game_started") {
        setRound(msg.round ?? 1);
        setPrompt(msg.prompt);
        setItems(msg.items);
        setSubmittedOrder([]);
        setCorrectOrder([]);
        setLifeLostPlayers([]);
        setEliminatedPlayers([]);
        setRemainingPlayers([]);
        setStatus("playing");
        startTimer(msg.timeLimit, msg.items);
      }

      if (msg.type === "round_results") {
        clearInterval(timerRef.current!);
        setResults(msg.results);
        setCorrectOrder(msg.correct);
        setLifeLostPlayers(msg.lifeLostPlayers || []);
        setEliminatedPlayers(msg.eliminatedPlayers || []);
        setRemainingPlayers(msg.remainingPlayers || []);
        setWinner(msg.results?.[0]?.name || "");
        setStatus((msg.eliminatedPlayers || []).includes(name) ? "eliminated" : "round_results");
      }

      if (msg.type === "game_over") {
        clearInterval(timerRef.current!);
        setResults(msg.results);
        setWinner(msg.winner);
        setCorrectOrder(msg.correct || []);
        setLifeLostPlayers([]);
        setEliminatedPlayers([]);
        setStatus("finished");
      }
    };
    ws.current.onerror = () => setError("Connection error — is the server running?");
  };

  const createRoom = () => {
    if (!name) { setError("Enter your name first"); return; }
    connect(() => ws.current?.send(JSON.stringify({ type: "create", name })));
  };

  const joinRoom = () => {
    if (!name) { setError("Enter your name first"); return; }
    if (inputCode.length !== 4) { setError("Room code must be 4 letters"); return; }
    connect(() => ws.current?.send(JSON.stringify({ type: "join", code: inputCode.toUpperCase(), name })));
  };

  const startGame = () => {
    ws.current?.send(JSON.stringify({ type: "start_game" }));
  };

  // called when the player clicks submit or the timer runs out
  const submitAnswer = (finalItems: RankedItem[]) => {
    clearInterval(timerRef.current!);
    setSubmittedOrder(finalItems);
    ws.current?.send(JSON.stringify({ type: "answer", items: finalItems }));
    setStatus("waiting");
  };

  // --- drag handlers ---
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault(); // required to allow dropping
    if (dragIndex === null || dragIndex === index) return;

    // reorder the items array by swapping dragged item into new position
    setItems((prev) => {
      const updated = [...prev];
      const dragged = updated.splice(dragIndex, 1)[0]; // remove from old position
      updated.splice(index, 0, dragged);               // insert at new position
      return updated;
    });
    setDragIndex(index); // update drag index to follow the item
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const reset = () => {
    ws.current?.close();
    ws.current = null;
    clearInterval(timerRef.current!);
    setStatus("idle");
    setName("");
    setRoomCode("");
    setInputCode("");
    setPlayers([]);
    setHost("");
    setResults([]);
    setWinner("");
    setRound(1);
    setLifeLostPlayers([]);
    setEliminatedPlayers([]);
    setRemainingPlayers([]);
    setError("");
    setPrompt("");
    setItems([]);
    setSubmittedOrder([]);
    setCorrectOrder([]);
    setTimeLeft(30);
  };

  const backToLobby = () => {
    clearInterval(timerRef.current!);
    setResults([]);
    setWinner("");
    setRound(1);
    setLifeLostPlayers([]);
    setEliminatedPlayers([]);
    setRemainingPlayers([]);
    setError("");
    setPrompt("");
    setItems([]);
    setSubmittedOrder([]);
    setCorrectOrder([]);
    setTimeLeft(30);
    setStatus("lobby");
  };

  return (
    <div style={{ textAlign: "center", fontFamily: "sans-serif", maxWidth: "400px", margin: "80px auto", padding: "0 16px" }}>

      {error && (
        <div style={{ color: "red", marginBottom: "16px" }}>
          {error}
          <button onClick={() => setError("")} style={{ marginLeft: "8px" }}>✕</button>
        </div>
      )}

      {/* home screen */}
      {status === "idle" && (
        <div>
          <h2>Ranking Game</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{ padding: "8px", width: "100%", boxSizing: "border-box", marginBottom: "24px", fontSize: "16px" }}
          />
          <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 12px" }}>Create a Room</h3>
            <button onClick={createRoom} style={{ padding: "8px 24px", width: "100%", fontSize: "16px", cursor: "pointer" }}>
              Create Room
            </button>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "16px" }}>
            <h3 style={{ margin: "0 0 12px" }}>Join a Room</h3>
            <input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              maxLength={4}
              style={{ padding: "8px", width: "100%", boxSizing: "border-box", marginBottom: "12px", letterSpacing: "4px", fontSize: "20px", textAlign: "center" }}
            />
            <button
              onClick={joinRoom}
              disabled={inputCode.length !== 4}
              style={{ padding: "8px 24px", width: "100%", fontSize: "16px", cursor: "pointer" }}
            >
              Join Room
            </button>
          </div>
        </div>
      )}

      {/* lobby */}
      {status === "lobby" && (
        <div>
          <h2>Room <span style={{ letterSpacing: "4px" }}>{roomCode}</span></h2>
          <p style={{ color: "gray" }}>Share this code with your friends</p>
          <h3>Players ({players.length})</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {players.map((p) => (
              <li key={p} style={{ marginBottom: "4px" }}>{p} {p === host && "👑"}</li>
            ))}
          </ul>
          {name === host ? (
            <button
              onClick={startGame}
              disabled={players.length < 2}
              style={{ padding: "8px 24px", marginTop: "16px", fontSize: "16px", cursor: "pointer" }}
            >
              {players.length < 2 ? "Waiting for players..." : "Start Game"}
            </button>
          ) : (
            <p style={{ color: "gray" }}>Waiting for host to start...</p>
          )}
        </div>
      )}

      {/* game screen — drag to reorder */}
      {status === "playing" && (
        <div>
          <p style={{ marginBottom: "8px", fontWeight: "bold" }}>Round {round}</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <p style={{ margin: 0, fontWeight: "bold", textAlign: "left" }}>{prompt}</p>
            {/* countdown timer — turns red when under 10 seconds */}
            <span style={{ fontSize: "24px", fontWeight: "bold", color: timeLeft <= 10 ? "red" : "black" }}>
              {timeLeft}s
            </span>
          </div>

          <p style={{ color: "gray", fontSize: "14px", marginBottom: "16px" }}>Drag to reorder</p>

          {/* draggable list */}
          <div>
            {items.map((item, index) => (
              <div
                key={item.item}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  padding: "12px 16px",
                  marginBottom: "8px",
                  backgroundColor: dragIndex === index ? "#e0e0e0" : "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  cursor: "grab",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  userSelect: "none",  // prevents text selection while dragging
                }}
              >
                <span style={{ color: "#999", fontWeight: "bold" }}>{index + 1}</span>
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.item}
                    style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                  />
                )}
                {item.item}
              </div>
            ))}
          </div>

          <button
            onClick={() => submitAnswer(items)}
            style={{ padding: "8px 24px", marginTop: "16px", fontSize: "16px", cursor: "pointer", width: "100%" }}
          >
            Submit Answer
          </button>
        </div>
      )}

      {/* waiting for other players */}
      {status === "waiting" && <p>Waiting for other players to finish...</p>}

      {/* round results for players still in */}
      {status === "round_results" && (
        <div>
          <h2>Round {round} Results</h2>
          {lifeLostPlayers.length > 0 && (
            <p style={{ color: "#92400e", fontWeight: "bold" }}>
              {lifeLostPlayers.join(", ")} lost 1 life{lifeLostPlayers.length > 1 ? " each" : ""}
            </p>
          )}
          {eliminatedPlayers.length > 0 && (
            <p style={{ color: "#b91c1c", fontWeight: "bold" }}>
              {eliminatedPlayers.join(", ")} {eliminatedPlayers.length === 1 ? "was" : "were"} eliminated
            </p>
          )}
          {remainingPlayers.length > 0 && <p>Remaining: {remainingPlayers.join(", ")}</p>}

          {results.map((r, i) => (
            <p key={r.name}>
              #{i + 1} {r.name}: <strong>{r.score} / 100</strong> · ❤️ {r.lives}
              {r.eliminated ? " (eliminated)" : ""}
            </p>
          ))}

          <h3>Your Order</h3>
          {submittedOrder.map((item, i) => {
            const isCorrect = item.item === correctOrder[i]?.item;
            return (
              <div
                key={item.item}
                style={{
                  padding: "8px",
                  marginBottom: "4px",
                  backgroundColor: isCorrect ? "#dcfce7" : "#fee2e2",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <span>{i + 1}.</span>
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.item}
                    style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                  />
                )}
                <span>{item.item} ({item.number})</span>
              </div>
            );
          })}

          <h3>Correct Order</h3>
          {correctOrder.map((item, i) => (
            <div
              key={item.item}
              style={{
                padding: "8px",
                marginBottom: "4px",
                backgroundColor: "#f5f5f5",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>{i + 1}.</span>
              {item.image && (
                <img
                  src={item.image}
                  alt={item.item}
                  style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                />
              )}
              <span>{item.item} ({item.number})</span>
            </div>
          ))}

          <p style={{ color: "gray", marginTop: "12px" }}>Next round starts automatically...</p>
        </div>
      )}

      {/* eliminated players wait for final winner */}
      {status === "eliminated" && (
        <div>
          <h2>You were eliminated in Round {round}</h2>
          {lifeLostPlayers.length > 0 && (
            <p style={{ color: "#92400e", fontWeight: "bold" }}>
              {lifeLostPlayers.join(", ")} lost 1 life{lifeLostPlayers.length > 1 ? " each" : ""}
            </p>
          )}
          {eliminatedPlayers.length > 0 && (
            <p style={{ color: "#b91c1c", fontWeight: "bold" }}>
              {eliminatedPlayers.join(", ")} {eliminatedPlayers.length === 1 ? "was" : "were"} eliminated
            </p>
          )}
          {remainingPlayers.length > 0 && <p>Remaining: {remainingPlayers.join(", ")}</p>}

          <h3>Your Order</h3>
          {submittedOrder.map((item, i) => {
            const isCorrect = item.item === correctOrder[i]?.item;
            return (
              <div
                key={item.item}
                style={{
                  padding: "8px",
                  marginBottom: "4px",
                  backgroundColor: isCorrect ? "#dcfce7" : "#fee2e2",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <span>{i + 1}.</span>
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.item}
                    style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                  />
                )}
                <span>{item.item} ({item.number})</span>
              </div>
            );
          })}

          <h3>Correct Order</h3>
          {correctOrder.map((item, i) => (
            <div
              key={item.item}
              style={{
                padding: "8px",
                marginBottom: "4px",
                backgroundColor: "#f5f5f5",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>{i + 1}.</span>
              {item.image && (
                <img
                  src={item.image}
                  alt={item.item}
                  style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                />
              )}
              <span>{item.item} ({item.number})</span>
            </div>
          ))}

          <p style={{ color: "gray", marginTop: "12px" }}>Waiting for the final winner...</p>
        </div>
      )}

      {/* results */}
      {status === "finished" && (
        <div>
          <h2>Results</h2>

          {/* scoreboard */}
          {results.map((r, i) => (
            <p key={r.name}>
              #{i + 1} {r.name}: <strong>{r.score} / 100</strong> · ❤️ {r.lives}
              {r.eliminated ? " (eliminated)" : ""}
              {r.name === winner && " 🏆"}
            </p>
          ))}

          {/* show the player's submitted order with correctness coloring */}
          <h3>Your Order</h3>
          {submittedOrder.map((item, i) => {
            const isCorrect = item.item === correctOrder[i]?.item;
            return (
              <div
                key={item.item}
                style={{
                  padding: "8px",
                  marginBottom: "4px",
                  backgroundColor: isCorrect ? "#dcfce7" : "#fee2e2",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <span>{i + 1}.</span>
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.item}
                    style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                  />
                )}
                <span>{item.item} ({item.number})</span>
              </div>
            );
          })}

          {/* reveal the correct answer */}
          <h3>Correct Order</h3>
          {correctOrder.map((item, i) => (
            <div
              key={item.item}
              style={{
                padding: "8px",
                marginBottom: "4px",
                backgroundColor: "#f5f5f5",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>{i + 1}.</span>
              {item.image && (
                <img
                  src={item.image}
                  alt={item.item}
                  style={{ width: "36px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                />
              )}
              <span>{item.item} ({item.number})</span>
            </div>
          ))}

          <h3>{winner === "tie" ? "It's a tie!" : `${winner} wins!`}</h3>
          <button onClick={backToLobby} style={{ padding: "8px 24px", marginTop: "16px", fontSize: "16px" }}>
            Back to Lobby
          </button>
          <button onClick={reset} style={{ padding: "8px 24px", marginTop: "8px", fontSize: "16px" }}>
            Leave Room
          </button>
        </div>
      )}

    </div>
  );
}