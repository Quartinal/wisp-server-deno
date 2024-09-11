// deno-lint-ignore-file require-await
import type { IncomingMessage } from "node:http";
//@deno-types="npm:@types/ws@^8.5.12"
import WebSocket, { WebSocketServer } from "npm:ws@^8.18.0";
import net from "node:net";
import type { Socket } from "node:net";
import dns from "node:dns/promises";
import dgram from "node:dgram";
import FrameParsers from "./Packets.ts";
import { STREAM_TYPE, PACKET_TYPE, LOG_LEVEL } from "./types.ts";
import type { WispFrame, WispOptions } from "./types.ts";
import { Logger } from "./util/Logger.ts";
import { handleWSProxy } from "./index.ts";
import { checkErrorCode } from "./util/Error.ts";
import { Buffer } from "node:buffer";

const wss = new WebSocketServer({ noServer: true });
const defaultOpts: WispOptions = { logLevel: LOG_LEVEL.INFO };

export async function routeRequest(
  wsOrIncomingMsg: WebSocket | IncomingMessage,
  socket?: Socket,
  head?: Buffer,
  opts: WispOptions = defaultOpts,
) {
  opts = Object.assign({}, defaultOpts, opts);

  if (!(wsOrIncomingMsg instanceof WebSocket) && socket && head) {
    wss.handleUpgrade(wsOrIncomingMsg, socket as Socket, head, (ws): void => {
      if (!wsOrIncomingMsg.url?.endsWith("/")) {
        handleWSProxy(ws, (wsOrIncomingMsg.url as string)!);
        return;
      }
      routeRequest(ws, undefined, undefined, opts);
    });
    return;
  }

  if (!(wsOrIncomingMsg instanceof WebSocket)) return;

  const ws = wsOrIncomingMsg as WebSocket;

  const connections = new Map();
  const logger = new Logger(opts.logLevel);

  ws.on("message", async data => {
    try {
      if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
        logger.error("Invalid WebSocket message data");
        return;
      }

      const wispFrame = FrameParsers.wispFrameParser(
        Buffer.from(data as Buffer),
      );

      // Routing
      if (wispFrame.type === PACKET_TYPE.CONNECT) {
        // CONNECT frame data
        const connectFrame = FrameParsers.connectPacketParser(
          wispFrame.payload,
        );

        if (connectFrame.streamType === STREAM_TYPE.TCP) {
          // Initialize and register Socket that will handle this stream
          const client = new net.Socket();
          client.connect(connectFrame.port, connectFrame.hostname);

          connections.set(wispFrame.streamID, {
            client: client,
            buffer: 127,
          });

          // Send Socket's data back to client
          client.on("data", function (data) {
            ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
          });

          // Close stream if there is some network error
          client.on("error", function (err) {
            logger.error(
              `An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`,
            );
            ws.send(
              FrameParsers.closePacketMaker(wispFrame, checkErrorCode(err)),
            );
            connections.delete(wispFrame.streamID);
          });

          client.on("close", function () {
            if (connections.get(wispFrame.streamID)) {
              ws.send(FrameParsers.closePacketMaker(wispFrame, 0x02));
              connections.delete(wispFrame.streamID);
            }
          });
        } else if (connectFrame.streamType === STREAM_TYPE.UDP) {
          let iplevel = net.isIP(connectFrame.hostname); // Can be 0: DNS NAME, 4: IPv4, 6: IPv6
          let host = connectFrame.hostname;

          if (iplevel === 0) {
            // is DNS
            try {
              host = (await dns.resolve(connectFrame.hostname))[0];
              iplevel = net.isIP(host); // can't be 0 now
            } catch (e) {
              logger.error(
                "Failure while trying to resolve hostname " +
                  connectFrame.hostname +
                  " with error: " +
                  e,
              );
              ws.send(FrameParsers.closePacketMaker(wispFrame, 0x42));
              return; // we're done here, ignore doing anything to this message now.
            }
          }

          // iplevel is now guaranteed to be 6 or 4, fingers crossed, so we can define the UDP type now
          if (iplevel !== 4 && iplevel !== 6) {
            return; // something went wrong.. neither ipv4 nor ipv6
          }

          // Create a new UDP socket
          const client = dgram.createSocket(iplevel === 6 ? "udp6" : "udp4");
          client.connect(connectFrame.port, host);
          //@ts-expect-error stupid workaround
          client.connected = false;

          client.on("connect", () => {
            //@ts-expect-error really dumb workaround
            client.connected = true;
          });
          // Handle incoming UDP data
          client.on("message", data => {
            ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
          });

          // Handle errors
          client.on("error", err => {
            logger.error(
              `An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`,
            );
            ws.send(
              FrameParsers.closePacketMaker(wispFrame, checkErrorCode(err)),
            );
            connections.delete(wispFrame.streamID);
            client.close();
          });

          client.on("close", function () {
            if (connections.get(wispFrame.streamID)) {
              ws.send(FrameParsers.closePacketMaker(wispFrame, 0x02));
              connections.delete(wispFrame.streamID);
            }
          });

          // Store the UDP socket and connectFrame in the connections map
          connections.set(wispFrame.streamID, {
            client,
          });
        }
      }

      if (wispFrame.type === PACKET_TYPE.DATA) {
        const stream = connections.get(wispFrame.streamID);
        if (stream && stream.client instanceof net.Socket) {
          stream.client.write(wispFrame.payload);
          stream.buffer--;
          if (stream.buffer === 0) {
            stream.buffer = 127;
            ws.send(FrameParsers.continuePacketMaker(wispFrame, stream.buffer));
          }
        } else if (stream && stream.client instanceof dgram.Socket) {
          stream.client.send(
            wispFrame.payload,
            undefined,
            undefined,
            (err: Error | null) => {
              if (err) {
                ws.send(
                  FrameParsers.closePacketMaker(wispFrame, checkErrorCode(err)),
                );
                if (stream.client.connected) {
                  stream.client.close();
                }
                connections.delete(wispFrame.streamID);
              }
            },
          );
        }
      }

      if (wispFrame.type === PACKET_TYPE.CLOSE) {
        // its joever
        logger.log(
          "Client decided to terminate with reason " +
            new DataView(wispFrame.payload.buffer).getUint8(0),
        );
        const stream = connections.get(wispFrame.streamID);
        if (stream && stream.client instanceof net.Socket) {
          stream.client.destroy();
        } else if (stream && stream.client instanceof dgram.Socket) {
          stream.client.close();
        }
        connections.delete(wispFrame.streamID);
      }
    } catch (err) {
      ws.close(); // something went SUPER wrong, like its probably not even a wisp connection
      logger.error(`WISP incoming message handler error: `, err);

      // cleanup
      for (const { client } of connections.values()) {
        if (client instanceof net.Socket) {
          client.destroy();
        } else if (client instanceof dgram.Socket) {
          client.close();
        }
      }
      connections.clear();
    }

    // Close all open sockets when the WebSocket connection is closed
    ws.on("close", (code, reason) => {
      logger.debug(
        `WebSocket connection closed with code ${code} and reason: ${reason}`,
      );
      for (const { client } of connections.values()) {
        if (client instanceof net.Socket) {
          client.destroy();
        } else if (client instanceof dgram.Socket) {
          client.close();
        }
      }
      connections.clear();
    });

    // SEND the initial continue packet with streamID 0 and 127 queue limit
    ws.send(
      FrameParsers.continuePacketMaker({ streamID: 0 } as WispFrame, 127),
    );
  });
}

export default {
  routeRequest,
};
