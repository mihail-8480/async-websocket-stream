import { getCallbackWriteStream } from "@mojsoski/async-stream";
import WebSocket from "ws";
import { getWebsocketStream, UTF8Encoding } from "./lib";
const ws = new WebSocket("wss://echo.websocket.org/");

getWebsocketStream(ws, UTF8Encoding, { clear: "none" }).then((stream) => {
  stream.transform().pipe(
    getCallbackWriteStream((message, resolve) => {
      console.log(message);
      resolve();
    }),
    { await: false }
  );

  stream.write("Test");
});
