import type { CodeUnit } from "../core/types";
import { partUid } from "../core/ids";

/**
 * One chunk per unit; a unit too large for the embedding model is split into
 * parts that each keep the signature on top, so a fragment from the middle of
 * a long function still says what it belongs to.
 *
 * There is no tokenizer here, so tokens are estimated from characters. Code
 * averages roughly 3–4 characters per token; 3.5 errs slightly towards
 * splitting early rather than overflowing the model's context.
 */

const CHARS_PER_TOKEN = 3.5;

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export type Chunk = {
  /** Embedding row id: the unit's uid, or `<uid>#part<n>` for a split unit. */
  uid: string;
  unitUid: string;
  code: string;
  startLine: number;
  endLine: number;
  part?: { index: number; total: number };
};

const REPEATED_HEADER_MAX = 200;

export const chunkUnit = ({ unit, maxTokens }: { unit: CodeUnit; maxTokens: number }): Chunk[] => {
  const budget = Math.max(200, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (unit.code.length <= budget) {
    return [{ uid: unit.uid, unitUid: unit.uid, code: unit.code, startLine: unit.startLine, endLine: unit.endLine }];
  }

  const lines = unit.code.split("\n");
  const signature = (unit.signature ?? lines[0] ?? "").trim().slice(0, REPEATED_HEADER_MAX);
  const continuationPrefix = `${signature}\n// … (continued)\n`;
  const room = Math.max(100, budget - continuationPrefix.length);

  type Piece = { text: string; startLine: number; endLine: number };
  const pieces: Piece[] = [];
  let buffer: { text: string; line: number }[] = [];
  let size = 0;

  const flush = (upTo: number) => {
    const taken = buffer.slice(0, upTo);
    if (taken.length === 0) return;
    pieces.push({
      text: taken.map((l) => l.text).join("\n"),
      startLine: unit.startLine + taken[0].line,
      endLine: unit.startLine + taken[taken.length - 1].line,
    });
    buffer = buffer.slice(upTo);
    size = buffer.reduce((sum, l) => sum + l.text.length + 1, 0);
  };

  lines.forEach((text, line) => {
    // A single line longer than a whole part (minified code, a data blob) is cut by characters.
    for (let offset = 0; offset === 0 || offset < text.length; offset += room) {
      const slice = text.length > room ? text.slice(offset, offset + room) : text;
      if (size + slice.length + 1 > room && buffer.length > 0) {
        // Prefer to cut at a blank line if one falls in the back half of the buffer.
        let cut = buffer.length;
        for (let i = buffer.length - 1; i >= Math.floor(buffer.length / 2); i--) {
          if (buffer[i].text.trim() === "") {
            cut = i + 1;
            break;
          }
        }
        flush(cut);
      }
      buffer.push({ text: slice, line });
      size += slice.length + 1;
      if (text.length <= room) break;
    }
  });
  flush(buffer.length);

  return pieces.map((piece, i) => ({
    uid: partUid({ uid: unit.uid, part: i + 1 }),
    unitUid: unit.uid,
    code: i === 0 ? piece.text : `${continuationPrefix}${piece.text}`,
    startLine: piece.startLine,
    endLine: piece.endLine,
    part: { index: i + 1, total: pieces.length },
  }));
};

/** Map an embedding row id back to the unit it came from. */
export const unitUidOfChunk = (chunkUid: string): string => chunkUid.replace(/#part\d+$/, "");
