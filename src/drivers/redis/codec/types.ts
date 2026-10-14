/**
 * Codec plugin — cơ chế giải mã/giải tuần tự giá trị Redis theo kiểu CẮM THÊM.
 *
 * KHÔNG fix cứng thuật toán nào (AES, Java serialize…). Mỗi "codec" là một bước
 * biến đổi độc lập, đăng ký tên trong registry. Một database Redis khai một CHUỖI
 * bước (`valueCodec` / `passwordCodec`); pipeline chạy lần lượt, output bước trước
 * là input bước sau. Nhờ vậy kiểu lưu của dvnh-common (AES/CBC rồi Java serialize)
 * chỉ là MỘT cấu hình, không phải code riêng — và thêm hệ khác (gzip, fernet,
 * protobuf…) chỉ cần đăng ký thêm một codec, không đụng tool.
 */

/** Ngữ cảnh truyền kèm mỗi lần decode (để codec cần biết key/db có thể dùng). */
export interface CodecContext {
  /** Tên key Redis đang đọc (đã gồm prefix). */
  key: string;
  /** Tên database trong config. */
  dbName: string;
}

/**
 * Một bước biến đổi. Nhận output bước trước (Buffer ở bước đầu), trả bất kỳ giá trị.
 * - Codec "byte→byte" (aes, base64, gunzip): nhận Buffer, trả Buffer.
 * - Codec "kết" (java, json, utf8): nhận Buffer, trả JS value (object/string/number).
 * Pipeline không ép kiểu: codec tự kiểm input và báo lỗi rõ nếu sai loại.
 */
export interface Codec {
  readonly name: string;
  decode(input: unknown, ctx: CodecContext): unknown;
}

/** Hàm dựng codec từ options khai trong config (đã là plain object). */
export type CodecFactory = (options: Record<string, unknown>) => Codec;

/** Ép input về Buffer, báo lỗi rõ ràng kèm tên codec nếu không phải Buffer. */
export function asBuffer(input: unknown, codecName: string): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") return Buffer.from(input, "latin1");
  throw new Error(
    `Codec '${codecName}' cần input dạng bytes (Buffer) nhưng nhận ${typeof input}. ` +
      `Kiểm tra lại thứ tự các bước trong codec chain.`
  );
}
