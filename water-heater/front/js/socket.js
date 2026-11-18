function createHeaterSocket({ url, onConnection, onMessage }) {
  const reconnectDelay = 2000;
  let socket;

  function connect() {
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
    const currentSocket = socket = new WebSocket(url);
    currentSocket.addEventListener("open", () => onConnection(true));
    currentSocket.addEventListener("message", event => {
      try { onMessage(JSON.parse(event.data)); }
      catch (error) { console.error("Invalid dashboard message", error); }
    });
    currentSocket.addEventListener("close", () => {
      if (socket !== currentSocket) return;
      socket = null;
      onConnection(false);
      setTimeout(connect, reconnectDelay);
    });
    currentSocket.addEventListener("error", () => currentSocket.close());
  }

  function send(event, data) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ event, data }));
    return true;
  }

  return { connect, send };
}
