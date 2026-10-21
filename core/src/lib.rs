//! Chess rules for Chess Arena, backed by shakmaty and compiled to WebAssembly.
//! The server (Node) and the browser load the same module, so both sides agree on
//! legal moves, SAN, FEN and how a game ends.

use shakmaty::fen::Fen;
use shakmaty::san::SanPlus;
use shakmaty::uci::UciMove;
use shakmaty::zobrist::Zobrist64;
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Position as _, Square};
use wasm_bindgen::prelude::*;

/// A position plus the history needed for threefold repetition.
#[wasm_bindgen]
pub struct Position {
    pos: Chess,
    /// Hashes of the positions since the last capture or pawn move, current one last.
    hashes: Vec<Zobrist64>,
}

#[wasm_bindgen]
impl Position {
    /// Start position, or the given FEN. Throws on an invalid FEN.
    #[wasm_bindgen(constructor)]
    pub fn new(fen: Option<String>) -> Result<Position, JsError> {
        let pos = match fen {
            Some(f) => Fen::from_ascii(f.as_bytes())
                .map_err(|e| JsError::new(&format!("bad FEN: {e}")))?
                .into_position(CastlingMode::Standard)
                .map_err(|e| JsError::new(&format!("bad FEN: {e}")))?,
            None => Chess::default(),
        };
        Ok(Position::from_chess(pos))
    }

    pub fn fen(&self) -> String {
        Fen::from_position(&self.pos, EnPassantMode::Legal).to_string()
    }

    /// 'w' or 'b'.
    pub fn turn(&self) -> String {
        self.pos.turn().char().to_string()
    }

    /// Piece code like 'wN' on a square ('e4'), if any.
    #[wasm_bindgen(js_name = pieceAt)]
    pub fn piece_at(&self, square: &str) -> Option<String> {
        let sq = square.parse::<Square>().ok()?;
        let p = self.pos.board().piece_at(sq)?;
        Some(format!("{}{}", p.color.char(), p.role.upper_char()))
    }

    /// All legal moves in UCI notation (castling as king two squares, e.g. e1g1).
    #[wasm_bindgen(js_name = legalMoves)]
    pub fn legal_moves(&self) -> Vec<String> {
        self.pos.legal_moves().iter().map(|m| m.to_uci(CastlingMode::Standard).to_string()).collect()
    }

    /// Legal moves of the piece on `square`, in UCI notation.
    #[wasm_bindgen(js_name = movesFrom)]
    pub fn moves_from(&self, square: &str) -> Vec<String> {
        let Ok(sq) = square.parse::<Square>() else { return Vec::new() };
        self.pos
            .legal_moves()
            .iter()
            .filter(|m| m.from() == Some(sq))
            .map(|m| m.to_uci(CastlingMode::Standard).to_string())
            .collect()
    }

    #[wasm_bindgen(js_name = isLegal)]
    pub fn is_legal(&self, uci: &str) -> bool {
        self.parse(uci).is_some()
    }

    /// Play a UCI move and return its SAN (with + or #). Throws if it isn't legal.
    pub fn play(&mut self, uci: &str) -> Result<String, JsError> {
        let m = self.parse(uci).ok_or_else(|| JsError::new(&format!("illegal move: {uci}")))?;
        if m.is_zeroing() {
            self.hashes.clear();
        }
        let san = SanPlus::from_move_and_play_unchecked(&mut self.pos, m);
        self.hashes.push(self.pos.zobrist_hash(EnPassantMode::Legal));
        Ok(san.to_string())
    }

    #[wasm_bindgen(js_name = isCheck)]
    pub fn is_check(&self) -> bool {
        self.pos.is_check()
    }

    /// Square of the king in check, if the side to move is in check.
    #[wasm_bindgen(js_name = checkedKing)]
    pub fn checked_king(&self) -> Option<String> {
        if !self.pos.is_check() {
            return None;
        }
        self.pos.board().king_of(self.pos.turn()).map(|sq| sq.to_string())
    }

    /// Why the game is over ('checkmate', 'stalemate', 'insufficient material',
    /// 'threefold repetition', '50-move rule'), or nothing while it goes on.
    /// On checkmate the side to move has lost.
    pub fn outcome(&self) -> Option<String> {
        let reason = if self.pos.is_checkmate() {
            "checkmate"
        } else if self.pos.is_stalemate() {
            "stalemate"
        } else if self.pos.is_insufficient_material() {
            "insufficient material"
        } else if self.repetitions() >= 3 {
            "threefold repetition"
        } else if self.pos.halfmoves() >= 100 {
            "50-move rule"
        } else {
            return None;
        };
        Some(reason.to_string())
    }

    /// True when `color` ('w' or 'b') can't possibly checkmate, e.g. a lone king.
    /// A player who runs out of time against such a side only draws.
    #[wasm_bindgen(js_name = hasInsufficientMaterial)]
    pub fn has_insufficient_material(&self, color: &str) -> bool {
        let c = if color == "b" { Color::Black } else { Color::White };
        self.pos.has_insufficient_material(c)
    }

    /// Independent copy (same position and repetition history).
    #[wasm_bindgen(js_name = clone)]
    pub fn duplicate(&self) -> Position {
        Position { pos: self.pos.clone(), hashes: self.hashes.clone() }
    }
}

impl Position {
    fn from_chess(pos: Chess) -> Position {
        let hashes = vec![pos.zobrist_hash(EnPassantMode::Legal)];
        Position { pos, hashes }
    }

    fn parse(&self, uci: &str) -> Option<shakmaty::Move> {
        uci.parse::<UciMove>().ok()?.to_move(&self.pos).ok()
    }

    fn repetitions(&self) -> usize {
        let Some(cur) = self.hashes.last() else { return 0 };
        self.hashes.iter().filter(|h| *h == cur).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play_all(p: &mut Position, moves: &str) -> Vec<String> {
        moves.split_whitespace().map(|m| p.play(m).map_err(|_| m.to_string()).unwrap()).collect()
    }

    #[test]
    fn san_and_fen() {
        let mut p = Position::from_chess(Chess::default());
        assert_eq!(play_all(&mut p, "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 e1g1"), ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "O-O"]);
        assert_eq!(p.fen(), "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 1 4");
        assert_eq!(p.turn(), "b");
        assert_eq!(p.piece_at("g1").as_deref(), Some("wK"));
        assert!(!p.is_legal("e1g1"));
    }

    #[test]
    fn checkmate() {
        let mut p = Position::from_chess(Chess::default());
        let san = play_all(&mut p, "f2f3 e7e5 g2g4 d8h4");
        assert_eq!(san[3], "Qh4#");
        assert_eq!(p.outcome().as_deref(), Some("checkmate"));
        assert_eq!(p.checked_king().as_deref(), Some("e1"));
    }

    #[test]
    fn threefold() {
        let mut p = Position::from_chess(Chess::default());
        play_all(&mut p, "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1");
        assert_eq!(p.outcome(), None);
        p.play("f6g8").unwrap();
        assert_eq!(p.outcome().as_deref(), Some("threefold repetition"));
    }

    #[test]
    fn promotion_and_material() {
        let mut p = Position::new_fen("8/4P3/8/8/8/8/k7/7K w - - 0 1");
        assert!(p.moves_from("e7").contains(&"e7e8q".to_string()));
        assert_eq!(p.play("e7e8n").unwrap(), "e8=N");
        assert!(p.has_insufficient_material("w"));
        assert!(p.has_insufficient_material("b"));
        assert_eq!(p.outcome().as_deref(), Some("insufficient material"));
    }

    impl Position {
        fn new_fen(fen: &str) -> Position {
            let pos = Fen::from_ascii(fen.as_bytes()).unwrap().into_position(CastlingMode::Standard).unwrap();
            Position::from_chess(pos)
        }
    }
}
