import crypto from "node:crypto";
import { Codec, CodecFactory, asBuffer } from "../types.js";

/**
 * Codec AES tổng quát (byte → byte). Mọi tham số khai trong config, không hệ nào
 * được hardcode. Diễn tả được cả hai lớp của dvnh-common:
 *   - value cache: mode=cbc, key=<secret>, keyHash=sha256, iv=zero
 *   - redis password: mode=ctr, key=<config-key>, keyHash=none, iv=prefix
 *
 * Options:
 *   mode        : cbc | ctr | ecb | cfb | ofb        (bắt buộc)
 *   key         : chuỗi key/secret                    (bắt buộc)
 *   keyEncoding : utf8 | hex | base64   (mặc định utf8) — cách đọc `key` ra bytes
 *   keyHash     : none | sha256 | sha1 | md5  (mặc định none) — băm key trước khi dùng
 *   iv          : zero | prefix | none | <hex>  (mặc định zero)
 *                 zero   = IV toàn 0; prefix = `ivLength` byte đầu của ciphertext là IV;
 *                 none   = không IV (ecb); <hex> = IV cố định cho sẵn.
 *   ivLength    : số byte IV (mặc định 16)
 *   padding     : true | false  (mặc định: true cho cbc/ecb, false cho stream mode)
 */
export const aesCodec: CodecFactory = (opts): Codec => {
  const mode = String(opts.mode ?? "").toLowerCase();
  if (!["cbc", "ctr", "ecb", "cfb", "ofb"].includes(mode)) {
    throw new Error(`Codec 'aes': 'mode' phải là cbc|ctr|ecb|cfb|ofb, nhận '${opts.mode}'`);
  }
  if (typeof opts.key !== "string" || opts.key.length === 0) {
    throw new Error("Codec 'aes': thiếu 'key'");
  }
  const keyEncoding = String(opts.keyEncoding ?? "utf8") as BufferEncoding;
  const keyHash = String(opts.keyHash ?? "none").toLowerCase();
  const ivMode = String(opts.iv ?? "zero").toLowerCase();
  const ivLength = typeof opts.ivLength === "number" ? opts.ivLength : 16;
  const isStream = mode === "ctr" || mode === "cfb" || mode === "ofb";
  const padding = typeof opts.padding === "boolean" ? opts.padding : !isStream;

  let keyBytes = Buffer.from(opts.key, keyEncoding);
  if (keyHash !== "none") {
    keyBytes = crypto.createHash(keyHash).update(keyBytes).digest();
  }
  if (![16, 24, 32].includes(keyBytes.length)) {
    throw new Error(
      `Codec 'aes': key dài ${keyBytes.length} byte (cần 16/24/32). ` +
        `Dùng keyHash=sha256 để băm về 32 byte nếu key là passphrase.`
    );
  }
  const algo = `aes-${keyBytes.length * 8}-${mode}`;

  const resolveIv = (data: Buffer): { iv: Buffer | null; body: Buffer } => {
    if (mode === "ecb" || ivMode === "none") return { iv: null, body: data };
    if (ivMode === "zero") return { iv: Buffer.alloc(ivLength), body: data };
    if (ivMode === "prefix") return { iv: data.subarray(0, ivLength), body: data.subarray(ivLength) };
    return { iv: Buffer.from(ivMode, "hex"), body: data }; // IV cố định dạng hex
  };

  return {
    name: "aes",
    decode(input) {
      const data = asBuffer(input, "aes");
      const { iv, body } = resolveIv(data);
      const decipher = crypto.createDecipheriv(algo, keyBytes, iv);
      decipher.setAutoPadding(padding);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    },
  };
};
