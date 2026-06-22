import net from "node:net";
import os from "node:os";
import { spawn, ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client, ConnectConfig } from "ssh2";
import { DbConfig, SshConfig } from "../config/schema.js";

export interface OpenTunnel {
  localPort: number;
  close(): Promise<void>;
}
export interface SshConnector {
  open(db: DbConfig): Promise<OpenTunnel>;
}

/** Mở rộng `~` ở đầu đường dẫn thành home directory. */
function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? p.replace(/^~/, os.homedir()) : p;
}

/**
 * Dựng ssh2 ConnectConfig từ cấu hình SSH.
 * - Có `privateKey` → xác thực bằng key file (hỗ trợ `~`, passphrase).
 * - Không có `privateKey` → fall back ssh-agent của máy (SSH_AUTH_SOCK).
 *   Đây là trường hợp "máy đã cấu hình ssh authen" (agent đã nạp key).
 * Lưu ý: ssh2 KHÔNG đọc ~/.ssh/config, nên Host alias/IdentityFile không áp.
 */
export function buildSshConnectConfig(ssh: SshConfig, env: NodeJS.ProcessEnv = process.env): ConnectConfig {
  const cfg: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.user,
    keepaliveInterval: 30000,
  };
  if (ssh.privateKey) {
    cfg.privateKey = readFileSync(expandHome(ssh.privateKey));
    if (ssh.passphrase) cfg.passphrase = ssh.passphrase;
  } else if (env.SSH_AUTH_SOCK) {
    cfg.agent = env.SSH_AUTH_SOCK;
  } else {
    throw new Error(
      `SSH '${ssh.host}': không có privateKey trong config và cũng không có ssh-agent (SSH_AUTH_SOCK). ` +
      `Khai 'privateKey' hoặc bật ssh-agent đã nạp key.`
    );
  }
  return cfg;
}

/** Xin một cổng TCP còn trống trên 127.0.0.1. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Đợi tới khi có thể connect TCP vào host:port, hoặc timeout. */
function waitForPort(host: string, port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`Tunnel local port ${port} không sẵn sàng sau ${timeoutMs}ms`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

/**
 * Mở tunnel bằng ssh2 (yêu cầu privateKey). ssh2 KHÔNG đọc ~/.ssh/config.
 */
function openViaSsh2(db: DbConfig): Promise<OpenTunnel> {
  const ssh = db.ssh!;
  return new Promise((resolve, reject) => {
    let connectCfg: ConnectConfig;
    try {
      connectCfg = buildSshConnectConfig(ssh);
    } catch (err) {
      reject(err);
      return;
    }
    const client = new Client();
    client
      .on("ready", () => {
        const server = net.createServer((sock) => {
          client.forwardOut(sock.remoteAddress || "127.0.0.1", sock.remotePort || 0, db.host, db.port, (err, stream) => {
            if (err) { sock.destroy(); return; }
            sock.pipe(stream).pipe(sock);
          });
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          const localPort = typeof addr === "object" && addr ? addr.port : 0;
          resolve({
            localPort,
            close: () => new Promise((res) => { server.close(() => { client.end(); res(); }); }),
          });
        });
      })
      .on("error", reject)
      .connect(connectCfg);
  });
}

/**
 * Mở tunnel bằng `ssh` của hệ thống (dùng khi KHÔNG khai privateKey).
 * Tận dụng nguyên ~/.ssh/config, default key, ssh-agent của máy — tương đương
 * lệnh `ssh -N -L <local>:<db.host>:<db.port> <user>@<bastion>` bạn vẫn chạy tay.
 * BatchMode=yes để fail nhanh thay vì treo chờ nhập mật khẩu.
 */
async function openViaSystemSsh(db: DbConfig): Promise<OpenTunnel> {
  const ssh = db.ssh!;
  const localPort = await getFreePort();
  const args = [
    "-N",
    "-L", `127.0.0.1:${localPort}:${db.host}:${db.port}`,
    "-p", String(ssh.port),
    "-o", "StrictHostKeyChecking=no",
    "-o", "BatchMode=yes",
    "-o", "ServerAliveInterval=60",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    `${ssh.user}@${ssh.host}`,
  ];

  const child: ChildProcess = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => { stderr += d.toString(); });

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code) => {
      reject(new Error(`ssh tunnel cho '${db.name}' thoát (code ${code}). ${stderr.trim()}`));
    });
    child.once("error", (err) => {
      reject(new Error(`Không spawn được 'ssh' cho '${db.name}': ${err.message}`));
    });
  });

  // Đợi local port mở, hoặc ssh chết trước
  await Promise.race([waitForPort("127.0.0.1", localPort), exited]);

  return {
    localPort,
    close: () => new Promise((res) => {
      child.removeAllListeners("exit");
      child.once("exit", () => res());
      child.kill("SIGTERM");
      // Phòng trường hợp không chết hẳn
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } res(); }, 3000).unref();
    }),
  };
}

/**
 * Connector mặc định (hybrid):
 * - Có `privateKey` → ssh2 (vòng đời sạch, thuần JS).
 * - Không có `privateKey` → spawn `ssh` hệ thống (dùng cấu hình ssh sẵn của máy).
 */
export const defaultConnector: SshConnector = {
  open(db: DbConfig): Promise<OpenTunnel> {
    return db.ssh!.privateKey ? openViaSsh2(db) : openViaSystemSsh(db);
  },
};

const tunnels = new Map<string, OpenTunnel>();

/** Trả endpoint để driver connect. Mở tunnel (cache theo tên DB) nếu DB có ssh. */
export async function ensure(db: DbConfig, connector: SshConnector = defaultConnector): Promise<{ host: string; port: number }> {
  if (!db.ssh) return { host: db.host, port: db.port };

  const existing = tunnels.get(db.name);
  if (existing) return { host: "127.0.0.1", port: existing.localPort };

  const t = await connector.open(db);
  tunnels.set(db.name, t);
  return { host: "127.0.0.1", port: t.localPort };
}

export async function shutdownAll(): Promise<void> {
  for (const [name, t] of tunnels) {
    try { await t.close(); } catch { /* ignore */ }
    tunnels.delete(name);
  }
}
