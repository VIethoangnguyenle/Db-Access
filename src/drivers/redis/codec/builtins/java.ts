import javaDeserialization from "java-deserialization";
import { Codec, CodecFactory, asBuffer } from "../types.js";

/**
 * Codec Java serialize (byte → JS value). Giải luồng `ObjectOutputStream`
 * (magic 0xACED) thành object JS. Dùng cho giá trị cache mà framework lưu bằng
 * `oos.writeObject(...)`.
 *
 * Options:
 *   index   : lấy object thứ mấy trong stream (mặc định 0)
 *   keepClass: true → thêm field `__class` = tên class Java (mặc định true)
 */
export const javaCodec: CodecFactory = (opts): Codec => {
  const index = typeof opts.index === "number" ? opts.index : 0;
  const keepClass = opts.keepClass !== false;

  const toPlain = (node: unknown, seen: WeakSet<object>): unknown => {
    if (node === null || typeof node !== "object") {
      return typeof node === "bigint" ? node.toString() : node;
    }
    if (Buffer.isBuffer(node)) return node.toString("base64");
    if (Array.isArray(node)) return node.map((x) => toPlain(x, seen));
    if (seen.has(node)) return "[circular]";
    seen.add(node);

    const obj = node as Record<string, unknown> & { class?: { name?: string } };
    const out: Record<string, unknown> = {};
    if (keepClass && obj.class && typeof obj.class.name === "string") {
      out.__class = obj.class.name;
    }
    // Chỉ lấy field enumerable (class/extends là hidden nên tự loại).
    for (const k of Object.keys(obj)) {
      out[k] = toPlain(obj[k], seen);
    }
    // Dữ liệu từ custom-serialization nằm ở property '@' (map/list đã được lib dựng).
    const custom = (obj as Record<string, unknown>)["@"];
    if (custom !== undefined) out["@"] = toPlain(custom, seen);
    return out;
  };

  return {
    name: "java",
    decode(input) {
      const buf = asBuffer(input, "java");
      const objects = javaDeserialization.parse(buf);
      if (!objects || objects.length <= index) {
        throw new Error(`Codec 'java': stream không có object ở index ${index}`);
      }
      return toPlain(objects[index], new WeakSet());
    },
  };
};
