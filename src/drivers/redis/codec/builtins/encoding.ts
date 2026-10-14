import zlib from "node:zlib";
import { Codec, CodecFactory, asBuffer } from "../types.js";

/** base64 (text → bytes). Dùng khi ciphertext được Redis lưu dưới dạng chuỗi base64. */
export const base64Codec: CodecFactory = (): Codec => ({
  name: "base64",
  decode(input) {
    const text = Buffer.isBuffer(input) ? input.toString("latin1") : String(input);
    return Buffer.from(text, "base64");
  },
});

/** hex (text → bytes). */
export const hexCodec: CodecFactory = (): Codec => ({
  name: "hex",
  decode(input) {
    const text = Buffer.isBuffer(input) ? input.toString("latin1") : String(input);
    return Buffer.from(text, "hex");
  },
});

/** utf8 (bytes → string). Thường là bước KẾT của chuỗi password. */
export const utf8Codec: CodecFactory = (): Codec => ({
  name: "utf8",
  decode(input) {
    return asBuffer(input, "utf8").toString("utf8");
  },
});

/** json (bytes/string → JS value). Bước KẾT cho cache lưu JSON thuần. */
export const jsonCodec: CodecFactory = (): Codec => ({
  name: "json",
  decode(input) {
    const text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
    return JSON.parse(text);
  },
});

/** gunzip (bytes → bytes). */
export const gunzipCodec: CodecFactory = (): Codec => ({
  name: "gunzip",
  decode(input) {
    return zlib.gunzipSync(asBuffer(input, "gunzip"));
  },
});

/** inflate zlib (bytes → bytes). */
export const inflateCodec: CodecFactory = (): Codec => ({
  name: "inflate",
  decode(input) {
    return zlib.inflateSync(asBuffer(input, "inflate"));
  },
});
