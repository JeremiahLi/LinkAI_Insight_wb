#!/usr/bin/env node
/**
 * 清掉 .next 目录后由 npm run dev:clean 继续启动 dev server。
 *
 * 背景（2026-10-21）：Turbopack dev 的 PostCSS 子进程 worker 入口位于
 * .next/dev/build/<hash>.js。该缓存若被上一次异常退出（强杀进程 / 蓝屏 / 黑屏
 * 断电）写坏，worker 子进程会启动后挂住不返回，Turbopack 于是不断新开 node
 * 子进程重试 —— 实测 15 秒内可堆到 1300+ 个 node.exe、吃掉数十 GB 内存，表现
 * 为风扇狂转 + 系统卡死黑屏。删除 .next 后即可恢复（9 个进程 / ~1.6GB）。
 */
import { rmSync } from "node:fs";

try {
  rmSync(".next", { recursive: true, force: true });
  console.log("[dev-clean] .next 已清除");
} catch (err) {
  console.error("[dev-clean] 清理失败，请先确认没有 dev server 在运行：", err.message);
  process.exit(1);
}
