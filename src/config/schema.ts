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
    type: z.enum(["oracle", "mongo"]),
    host: z.string().min(1),
    port: z.number().int().positive(),
    service: z.string().optional(),  // oracle service name
    database: z.string().optional(), // mongo database name
    user: z.string().min(1),
    password: z.string(),
    ssh: sshSchema.optional(),
  })
  .refine((d) => d.type !== "oracle" || !!d.service, {
    message: "oracle database requires 'service'",
  })
  .refine((d) => d.type !== "mongo" || !!d.database, {
    message: "mongo database requires 'database'",
  });
export type RawDb = z.infer<typeof dbSchema>;

export const sourceSchema = z.object({
  apiKey: z.string().min(1),
  access: z.record(z.string(), z.array(capabilitySchema)),
});

export const appConfigSchema = z.object({
  databases: z.record(z.string(), dbSchema),
  sources: z.record(z.string(), sourceSchema),
});

// Resolved (name attached) types used across the app
export interface DbConfig extends RawDb { name: string; }
export interface Source {
  name: string;
  apiKey: string;
  access: Record<string, Capability[]>;
}
export interface AppConfig {
  databases: Record<string, DbConfig>;
  sources: Record<string, Source>;
}
