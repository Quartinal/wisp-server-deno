//@deno-types="npm:@types/ws@^8.5.12"
import type WebSocket from "npm:ws@^8.18.0";
import { Socket } from "node:net";

// deno-lint-ignore require-await
export async function handleWSProxy(ws: WebSocket, url: string) {
  const client = new Socket();
  try {
    const dest = url.split("/").pop()!.split(":");
    const host = dest[0];
    const port = parseInt(dest[1]);

    client.connect(port, host);

    client.on("data", data => ws.send(data));

    //@ts-ignore the event parameter in real life doesn't have an any type
    ws.onmessage = event => client.write(event.data as string | Uint8Array);

    ws.onclose = () => client.destroy();

    client.on("close", () => ws.close());
  } catch (_) {
    ws.close();
    client.destroy();
  }
}
