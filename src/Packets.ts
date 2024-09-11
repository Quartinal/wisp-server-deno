import { PACKET_TYPE } from "./types.ts";
import type { WispFrame } from "./types.ts";
import { Buffer } from "node:buffer";

export function wispFrameParser(data: Buffer): WispFrame {
  const uint8arrayView = new Uint8Array(data);
  const dataView = new DataView(uint8arrayView.buffer);
  const type: PACKET_TYPE = dataView.getUint8(0);
  const streamID = dataView.getUint32(1, true);
  const payload = uint8arrayView.slice(5, uint8arrayView.byteLength);

  return {
    type,
    streamID,
    payload,
  };
}

export function connectPacketParser(payload: Uint8Array) {
  const dataview = new DataView(payload.buffer);
  const streamType = dataview.getUint8(0);
  const port = dataview.getUint16(1, true);
  const hostname = new TextDecoder("utf8").decode(
    dataview.buffer.slice(3, dataview.buffer.byteLength),
  );
  return {
    dataview,
    streamType,
    port,
    hostname,
  };
}

export function continuePacketMaker(wispFrame: WispFrame, queue: number) {
  const initialPacket = new DataView(new Uint8Array(9).buffer);
  initialPacket.setUint8(0, PACKET_TYPE.CONTINUE);
  initialPacket.setUint32(1, wispFrame.streamID, true);
  initialPacket.setUint32(5, queue, true);
  return initialPacket.buffer;
}

export function closePacketMaker(wispFrame: WispFrame, reason: number) {
  const closePacket = new DataView(new Uint8Array(9).buffer);
  closePacket.setUint8(0, PACKET_TYPE.CLOSE);
  closePacket.setUint32(1, wispFrame.streamID, true);
  closePacket.setUint8(5, reason);

  return closePacket.buffer;
}

export function dataPacketMaker(wispFrame: WispFrame, data: Buffer) {
  const dataPacketHeader = new DataView(new Uint8Array(5).buffer);
  dataPacketHeader.setUint8(0, PACKET_TYPE.DATA);
  dataPacketHeader.setUint32(1, wispFrame.streamID, true);

  return Buffer.concat([Buffer.from(dataPacketHeader.buffer), data]);
}

export default {
  wispFrameParser,
  connectPacketParser,
  continuePacketMaker,
  closePacketMaker,
  dataPacketMaker,
};
