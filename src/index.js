// app-launcher/src/index.js —— 应用启动器 MCP server
// 工具：launch_app（按名称/路径启动软件）、list_apps（查看已注册软件）
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = join(__dirname, "..", "apps.json");

// ---------- 加载软件注册表（apps.json） ----------
let registry = {};
try {
  registry = JSON.parse(await readFile(APPS_FILE, "utf8"));
} catch (err) {
  console.error(`[app-launcher] 读取 ${APPS_FILE} 失败：${err.message}`);
}

// 名称 + 别名 → 应用配置 的索引（不区分大小写）
const appIndex = new Map();
for (const [key, cfg] of Object.entries(registry)) {
  appIndex.set(key.toLowerCase(), cfg);
  for (const alias of cfg.aliases ?? []) {
    appIndex.set(String(alias).toLowerCase(), cfg);
  }
}

function resolveTarget(app) {
  // 1) 注册表名称 / 别名
  const cfg = appIndex.get(String(app).toLowerCase());
  if (cfg) {
    return {
      type: cfg.type ?? "exe",
      path: cfg.path,
      args: cfg.args ?? [],
      label: cfg.name ?? String(app),
    };
  }
  // 2) 直接作为路径（绝对或相对）
  try {
    const p = resolve(String(app));
    if (existsSync(p)) {
      return statSync(p).isDirectory()
        ? { type: "folder", path: p, args: [], label: p }
        : { type: "exe", path: p, args: [], label: p };
    }
  } catch {
    /* 路径无效则返回 null */
  }
  return null;
}

/** Windows 路径统一转正斜杠（spawn/explorer 均接受），避免反斜杠在转义链中出错 */
const toPosix = (p) => String(p).replace(/\\/g, "/");

/** 通过任务计划程序独立启动（Task Scheduler 派生的进程完全脱离 Node 的 Job Object） */
function launchViaSchtasks(target, extraArgs = []) {
  const taskName = `app_launcher_${process.pid}_${Date.now()}`;
  const args = [...(target.args ?? []), ...(extraArgs ?? [])];
  const argStr = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(" ");
  const tr = `"${toPosix(target.path)}"${argStr ? " " + argStr : ""}`;
  return new Promise((res, rej) => {
    const create = spawn("schtasks.exe", ["/create", "/f", "/tn", taskName, "/tr", tr, "/sc", "once", "/st", "00:00"]);
    create.on("error", (err) => rej(new Error(`启动失败：${err.message}`)));
    create.on("close", (code) => {
      if (code !== 0) return rej(new Error(`创建计划任务失败（code=${code}）`));
      const run = spawn("schtasks.exe", ["/run", "/tn", taskName]);
      run.on("error", (err) => rej(new Error(`运行计划任务失败：${err.message}`)));
      run.on("close", () => {
        // 清理任务定义（不影响已启动的进程）
        spawn("schtasks.exe", ["/delete", "/f", "/tn", taskName], { stdio: "ignore" }).on("error", () => {});
        res({ pid: null, kind: "task", path: target.path });
      });
    });
  });
}

/** 启动目标进程：folder 用 explorer；程序统一走任务计划程序，保证独立存活 */
async function launch(target, extraArgs = [], cwd) {
  if (target.type === "folder") {
    const child = spawn("explorer.exe", [toPosix(target.path)], { detached: true, stdio: "ignore" });
    return new Promise((res, rej) => {
      child.once("spawn", () => {
        child.unref();
        res({ pid: child.pid, kind: "folder", path: target.path });
      });
      child.on("error", (err) => rej(new Error(`启动失败：${err.message}`)));
    });
  }
  return launchViaSchtasks(target, extraArgs);
}

function errorResult(err) {
  return {
    content: [{ type: "text", text: `❌ ${err?.message ?? String(err)}` }],
    isError: true,
  };
}

const server = new McpServer({ name: "app-launcher-mcp", version: "1.0.0" });

// ---------- 工具 1：启动软件 ----------
server.tool(
  "launch_app",
  {
    app: z
      .string()
      .describe(
        "要启动的软件：apps.json 注册名或别名（如 halcon、记事本、edge），或直接传可执行文件/文件夹/文档的完整路径"
      ),
    args: z.array(z.string()).optional().describe("启动参数（可选）"),
    cwd: z.string().optional().describe("工作目录（可选）"),
  },
  async ({ app, args, cwd }) => {
    try {
      const target = resolveTarget(app);
      if (!target) {
        return errorResult(
          new Error(
            `找不到软件「${app}」：未在注册表中登记且路径不存在。可用 list_apps 查看已注册软件，或直接传完整路径（如 C:\\Program Files\\xxx\\app.exe）。`
          )
        );
      }
      const info = await launch(target, args, cwd);
      const pidText = info.pid
        ? `\nPID：${info.pid}`
        : "\n（已通过任务计划程序独立启动，关闭本会话不影响运行）";
      return {
        content: [
          {
            type: "text",
            text: `✅ 已启动 ${target.label}（${info.kind === "folder" ? "文件夹" : "程序"}）\n路径：${info.path}${pidText}`,
          },
        ],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ---------- 工具 2：列出已注册软件 ----------
server.tool("list_apps", {}, async () => {
  const lines = Object.entries(registry).map(([key, cfg]) => {
    const aliases = cfg.aliases?.length ? `（别名：${cfg.aliases.join("、")}）` : "";
    return `- ${key}${aliases} → ${cfg.path}`;
  });
  return {
    content: [
      { type: "text", text: `已注册软件（${lines.length} 个）：\n${lines.join("\n")}` },
    ],
  };
});

// ---------- 启动 ----------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[app-launcher] 已启动：可通过 launch_app / list_apps 打开本机软件");
}

main().catch((err) => {
  console.error("[app-launcher] 启动失败：", err);
  process.exit(1);
});
