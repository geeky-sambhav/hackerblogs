/** Worker thread: answers { id, html } with { id, words } using Readability. */
import { parentPort } from "node:worker_threads";
import { readabilityWordCount } from "./meta";

parentPort?.on("message", (msg: { id: number; html: string }) => {
  parentPort?.postMessage({ id: msg.id, words: readabilityWordCount(msg.html) });
});
