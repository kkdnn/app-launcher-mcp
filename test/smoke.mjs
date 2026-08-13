// app-launcher/test/smoke.mjs —— 冒烟测试：连接 server，验证 list_apps 与 launch_app（启动记事本）
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverScript = join(__dirname, "..", "src", "index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverScript],
  env: process.env,
});
const client = new Client({ name: "app-launcher-smoke", version: "0.1.0" });

try {
  await client.connect(transport);

  // 1) 工具列表
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log("工具列表:", names.join(", "));
  assert.deepEqual(names, ["launch_app", "list_apps"]);

  // 2) list_apps —— 应包含 halcon
  const apps = await client.callTool({ name: "list_apps", arguments: {} });
  const appsText = apps.content?.[0]?.text ?? "";
  console.log("已注册软件数:", (appsText.match(/- /g) ?? []).length);
  assert.ok(appsText.includes("halcon"), "注册表中应有 halcon");
  assert.ok(appsText.includes("notepad"), "注册表中应有 notepad");

  // 3) launch_app —— 启动记事本（真实启动，验证 schtasks 链路）
  const r = await client.callTool({ name: "launch_app", arguments: { app: "notepad" } });
  console.log("launch_app(notepad) →", r.content?.[0]?.text);
  assert.ok(r.isError !== true, `launch_app 失败: ${r.content?.[0]?.text}`);
  assert.ok(r.content?.[0]?.text?.includes("已启动"), "应返回已启动提示");

  // 4) 未注册 + 不存在路径 → 友好错误
  const bad = await client.callTool({ name: "launch_app", arguments: { app: "不存在的软件xyz" } });
  assert.equal(bad.isError, true);
  console.log("未注册软件错误提示 →", bad.content?.[0]?.text?.slice(0, 50));

  console.log("app-launcher smoke.mjs: 冒烟测试通过 ✅");
} finally {
  await client.close();
}
