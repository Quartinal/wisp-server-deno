import wisp from "./ConnectionHandler.ts";
import { createServer } from "node:http";
import { LOG_LEVEL } from "./types.ts";
import type { Socket } from "node:net";
import process from "node:process";

const http = createServer().listen(process.env.PORT || 3000);

http.on("upgrade", (req, socket, head) => {
  wisp.routeRequest(req, socket as Socket, head, {
    logLevel: LOG_LEVEL.DEBUG,
  });
});
