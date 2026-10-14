import { Codec, CodecContext, CodecFactory } from "./types.js";
export type { Codec } from "./types.js";
import { aesCodec } from "./builtins/aes.js";
import { javaCodec } from "./builtins/java.js";
import {
  base64Codec,
  hexCodec,
  utf8Codec,
  jsonCodec,
  gunzipCodec,
  inflateCodec,
} from "./builtins/encoding.js";

/**
 * Registry codec — nơi duy nhất biết tên codec nào ứng với factory nào.
 * Thêm hệ mã hoá/định dạng mới = `registerCodec("tên", factory)`, không sửa tool.
 */
const registry = new Map<string, CodecFactory>();

export function registerCodec(name: string, factory: CodecFactory): void {
  registry.set(name, factory);
}

export function hasCodec(name: string): boolean {
  return registry.has(name);
}

// Đăng ký bộ codec dựng sẵn.
registerCodec("aes", aesCodec);
registerCodec("java", javaCodec);
registerCodec("base64", base64Codec);
registerCodec("hex", hexCodec);
registerCodec("utf8", utf8Codec);
registerCodec("json", jsonCodec);
registerCodec("gunzip", gunzipCodec);
registerCodec("inflate", inflateCodec);

export interface CodecStep {
  codec: string;
  [option: string]: unknown;
}

/** Dựng chuỗi codec từ khai báo config. Lỗi sớm nếu tên codec lạ. */
export function buildPipeline(steps: CodecStep[] | undefined): Codec[] {
  if (!steps || steps.length === 0) return [];
  return steps.map((step) => {
    const factory = registry.get(step.codec);
    if (!factory) {
      throw new Error(
        `Codec '${step.codec}' chưa đăng ký. Có sẵn: ${[...registry.keys()].join(", ")}`
      );
    }
    const { codec, ...options } = step;
    return factory(options);
  });
}

/** Chạy chuỗi codec trên một giá trị bytes ban đầu. Chuỗi rỗng → trả nguyên input. */
export function runPipeline(pipeline: Codec[], input: Buffer, ctx: CodecContext): unknown {
  let current: unknown = input;
  for (const codec of pipeline) {
    current = codec.decode(current, ctx);
  }
  return current;
}
