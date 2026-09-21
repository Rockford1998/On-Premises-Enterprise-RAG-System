/**
 * Retrieval evaluation.
 *
 * Measures whether the right code comes back, separately from whether the
 * model writes a good answer — a bad answer built on the right code is a
 * prompt problem, while a good-sounding answer built on the wrong code is the
 * failure that matters. Only retrieval is scored here.
 *
 *   npm run code:eval -- --bot <botId> [--questions eval/questions.json] [--limit 10]
 *
 * Results are written to eval/results/<timestamp>.json so the effect of a
 * change to chunking, weights or expansion can be compared run to run.
 */
import dotenv from "dotenv";

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? "dev"}` });

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { closeMongo, mongoCnnection } from "../src/db/mongo";
import { closePostgres, initPostgres } from "../src/db/pgsql";
import { CodeSearchService, SearchHit } from "../src/services/codeSearch.service";
import { BotService } from "../src/services/bot.service";

type Question = { q: string; type: string; expected: string[] };
type QuestionFile = { questions: Question[] };

type Scored = {
  question: string;
  type: string;
  expected: string[];
  /** 1-based rank of the first expected unit, or null when none was retrieved. */
  firstHitRank: number | null;
  recallAt5: number;
  recallAt10: number;
  returned: string[];
};

const arg = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const rankOfFirstExpected = (hits: SearchHit[], expected: string[]): number | null => {
  const index = hits.findIndex((hit) => expected.includes(hit.uid));
  return index === -1 ? null : index + 1;
};

const hitWithin = (rank: number | null, n: number): number => (rank !== null && rank <= n ? 1 : 0);

const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

const table = (rows: { label: string; count: number; r5: number; r10: number; mrr: number }[]): string => {
  const header = `${"segment".padEnd(14)}${"n".padStart(4)}${"recall@5".padStart(11)}${"recall@10".padStart(12)}${"MRR".padStart(8)}`;
  const line = "-".repeat(header.length);
  const body = rows.map(
    (r) => `${r.label.padEnd(14)}${String(r.count).padStart(4)}${r.r5.toFixed(3).padStart(11)}${r.r10.toFixed(3).padStart(12)}${r.mrr.toFixed(3).padStart(8)}`,
  );
  return [header, line, ...body].join("\n");
};

const main = async (): Promise<void> => {
  const botId = arg("bot");
  if (!botId) {
    console.error("Usage: npm run code:eval -- --bot <botId> [--questions <file>] [--limit 10]");
    process.exit(2);
  }
  const questionsPath = path.resolve(arg("questions", path.join(__dirname, "questions.json"))!);
  const limit = Number(arg("limit", "10"));

  const file = JSON.parse(fs.readFileSync(questionsPath, "utf8")) as QuestionFile;
  if (!Array.isArray(file.questions) || file.questions.length === 0) {
    throw new Error(`No questions in ${questionsPath}`);
  }

  await mongoCnnection();
  await initPostgres();

  try {
    const bot = await new BotService().readByBotId(botId);
    if (!bot) throw new Error(`No bot with id ${botId}`);
    if (bot.botType !== "Code_Interpreter") throw new Error(`${botId} is not a Code_Interpreter bot`);
    // Evaluation runs as the bot's owner: it is a local diagnostic, not an API surface.
    const actor = { email: bot.owner?.email ?? "", roles: ["CONFIG_ADMIN"] };

    const service = new CodeSearchService();
    const scored: Scored[] = [];

    for (const question of file.questions) {
      const { hits } = await service.search({ botId, actor, query: question.q, limit: Math.max(limit, 10) });
      const rank = rankOfFirstExpected(hits, question.expected);
      scored.push({
        question: question.q,
        type: question.type,
        expected: question.expected,
        firstHitRank: rank,
        recallAt5: hitWithin(rank, 5),
        recallAt10: hitWithin(rank, 10),
        returned: hits.slice(0, 10).map((h) => h.uid),
      });
      process.stdout.write(rank !== null && rank <= 10 ? "." : "x");
    }
    process.stdout.write("\n\n");

    const segment = (label: string, rows: Scored[]) => ({
      label,
      count: rows.length,
      r5: mean(rows.map((r) => r.recallAt5)),
      r10: mean(rows.map((r) => r.recallAt10)),
      mrr: mean(rows.map((r) => (r.firstHitRank ? 1 / r.firstHitRank : 0))),
    });
    const types = [...new Set(scored.map((s) => s.type))].sort();
    const rows = [segment("overall", scored), ...types.map((type) => segment(type, scored.filter((s) => s.type === type)))];
    console.log(table(rows));

    const missed = scored.filter((s) => s.recallAt10 === 0);
    if (missed.length > 0) {
      console.log(`\nNot found in the top 10 (${missed.length}):`);
      for (const miss of missed) {
        console.log(`  ${JSON.stringify(miss.question)}\n    expected one of: ${miss.expected.join(", ")}\n    got: ${miss.returned.slice(0, 5).join(", ") || "(nothing)"}`);
      }
    }

    const outDir = path.join(__dirname, "results");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ botId, questionsPath, at: new Date().toISOString(), summary: rows, results: scored }, null, 2));
    console.log(`\nWritten to ${path.relative(process.cwd(), outFile)}`);

    const overall = rows[0];
    console.log(overall.r10 >= 0.8 ? "\nrecall@10 target (0.8) met." : `\nrecall@10 is ${overall.r10.toFixed(3)}; the target is 0.8.`);
  } finally {
    await Promise.allSettled([closePostgres(), closeMongo()]);
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error("Evaluation failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
