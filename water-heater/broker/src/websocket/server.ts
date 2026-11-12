import { WebSocketServer, WebSocket } from "ws";

export const wss = new WebSocketServer({
    port: 8080,
    maxPayload: 4096
});

export function broadcast(data: object): void {
    const message = JSON.stringify(data);

    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

wss.on("connection", (client) => {
    console.log("WebSocket client connected");

    client.on("error", (error) => console.warn("WebSocket client error:", error.message));

    client.on("close", () => {
        console.log("WebSocket client disconnected");
    });
});

wss.on("listening", () => {
    console.log("WebSocket server listening on port 8080");
});