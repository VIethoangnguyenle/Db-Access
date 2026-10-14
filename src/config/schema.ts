import { z } from "zod";

export const capabilitySchema = z.enum(["read", "write", "script"]);
export type Capability = z.infer<typeof capabilitySchema>;

export const sshSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  user: z.string().min(1),
  // Optional: nếu bỏ trống, server dùng ssh-agent (SSH_AUTH_SOCK) của máy.
  privateKey: z.string().min(1).optional(),
  passphrase: z.string().optional(),
});
export type SshConfig = z.infer<typeof sshSchema>;

// Một bước codec: bắt buộc có `codec` (tên), còn lại là options tuỳ codec.
export const codecStepSchema = z
  .object({ codec: z.string().min(1) })
  .catchall(z.unknown());
export type CodecStepConfig = z.infer<typeof codecStepSchema>;

// Một node sentinel "host:port".
export const sentinelNodeSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
});

export const dbSchema = z
  .object({
    type: z.enum(["oracle", "mongo", "postgres", "redis"]),
    host: z.string().min(1).optional(),
    port: z.number().int().positive().optional(),
    service: z.string().optional(),  // oracle service name
    database: z.string().optional(), // mongo / postgres database name
    user: z.string().min(1).optional(),
    password: z.string().optional(),
    ssh: sshSchema.optional(),

    // ── Redis ──────────────────────────────────────────────────────────────
    // Kết nối: hoặc sentinel (nodes + master), hoặc trực tiếp host/port.
    sentinels: z
      .union([z.string().min(1), z.array(sentinelNodeSchema)])
      .optional(), // "h:p,h:p" hoặc [{host,port}]
    master: z.string().optional(),      // tên master khi dùng sentinel
    db: z.number().int().nonnegative().optional(), // chỉ số DB (0..15)
    keyPrefix: z.string().optional(),   // prefix nghiệp vụ (vd "vietbank-sme")
    // Chuỗi codec giải GIÁ TRỊ value và giải MẬT KHẨU (nếu password là ciphertext).
    valueCodec: z.array(codecStepSchema).optional(),
    passwordCodec: z.array(codecStepSchema).optional(),
  })
  .refine((d) => d.type !== "oracle" || (!!d.service && !!d.host && !!d.port && !!d.user), {
    message: "oracle database requires 'service', 'host', 'port', 'user'",
  })
  .refine(
    (d) => !["mongo", "postgres"].includes(d.type) || (!!d.database && !!d.host && !!d.port && !!d.user),
    { message: "mongo/postgres database requires 'database', 'host', 'port', 'user'" }
  )
  .refine((d) => d.type !== "redis" || !!d.sentinels || (!!d.host && !!d.port), {
    message: "redis database requires 'sentinels' (+ 'master') or 'host'+'port'",
  });
export type RawDb = z.infer<typeof dbSchema>;

// Một entry access có 2 dạng:
//   - shorthand: [read, write]                         (chỉ capabilities)
//   - object:    { capabilities: [...], description }   (kèm mô tả cho agent)
export const accessEntrySchema = z.union([
  z.array(capabilitySchema),
  z.object({
    capabilities: z.array(capabilitySchema),
    description: z.string().optional(),
  }),
]);

export const sourceSchema = z.object({
  apiKey: z.string().min(1),
  access: z.record(z.string(), accessEntrySchema),
});

export const appConfigSchema = z.object({
  databases: z.record(z.string(), dbSchema),
  sources: z.record(z.string(), sourceSchema),
});

// Resolved (name attached) types used across the app
export interface DbConfig extends RawDb { name: string; }

/** Quyền truy cập + mô tả (cho agent) của một source lên một database. */
export interface DbAccess {
  capabilities: Capability[];
  description?: string;
}
export interface Source {
  name: string;
  apiKey: string;
  access: Record<string, DbAccess>;
}
export interface AppConfig {
  databases: Record<string, DbConfig>;
  sources: Record<string, Source>;
}
