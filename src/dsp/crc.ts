/**
 * Checksums. These are what stand between "we decoded something" and
 * "we decoded the right thing" - the PRD's zero-false-positive requirement
 * rests entirely on the payload CRC-16 refusing to pass on room noise.
 */

const CRC16_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

/** CRC-16/CCITT-FALSE. */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) & 0xffff) ^ CRC16_TABLE[((crc >> 8) ^ data[i]) & 0xff];
  return crc;
}

const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

/** CRC-8/ATM, used to sanity-check the tiny frame header. */
export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = CRC8_TABLE[crc ^ data[i]];
  return crc;
}
