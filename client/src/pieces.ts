/** Piece code like 'wN' or 'bp' → image URL (cburnett set in /public/pieces). */
export function pieceUrl(code: string) {
  return `/pieces/${code[0]}${code[1].toUpperCase()}.svg`;
}

const CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];

/** Loaded images for canvas drawing. */
export const pieceImages = new Map<string, HTMLImageElement>();
export const piecesReady = Promise.all(
  CODES.map(
    (c) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = pieceUrl(c);
        pieceImages.set(c, img);
      }),
  ),
);

/** Parse the board part of a FEN into 64 codes ('' for empty), index 0 = a8. */
export function parseFen(fen: string): string[] {
  const out: string[] = [];
  for (const ch of fen.split(' ')[0]) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push('');
    else out.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
  }
  return out;
}

/** 'e4' → index into parseFen output. */
export function sqIndex(sq: string) {
  return (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);
}

export function sqName(i: number) {
  return String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
}
