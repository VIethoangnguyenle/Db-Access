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

export const dbSchema = z
  .object({
    type: z.enum(["oracle", "mongo", "postgres"]),
    host: z.string().min(1),
    port: z.number().int().positive(),
    service: z.string().optional(),  // oracle service name
    database: z.string().optional(), // mongo / postgres database name
    user: z.string().min(1),
    password: z.string(),
    ssh: sshSchema.optional(),
  })
  .refine((d) => d.type !== "oracle" || !!d.service, {
    message: "oracle database requires 'service'",
  })
  .refine((d) => !["mongo", "postgres"].includes(d.type) || !!d.database, {
    message: "mongo/postgres database requires 'database'",
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
