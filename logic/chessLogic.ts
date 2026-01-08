
import { Color, PieceType, Position, Piece, Move, BoardState } from '../types';

export const posToKey = (pos: Position) => `${pos.x},${pos.y}`;
export const keyToPos = (key: string): Position => {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
};

export class ChessEngine {
  static getValidMoves(state: BoardState, pos: Position, ignoreCheck: boolean = false): Position[] {
    const piece = state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
    if (!piece) return [];

    let moves: Position[] = [];

    switch (piece.type) {
      case PieceType.PAWN:
        moves = this.getPawnMoves(state, piece);
        break;
      case PieceType.ROOK:
        moves = this.getSlidingMoves(state, piece, [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
        break;
      case PieceType.BISHOP:
        moves = this.getSlidingMoves(state, piece, [{ x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }]);
        break;
      case PieceType.KNIGHT:
        moves = this.getKnightMoves(state, piece);
        break;
      case PieceType.QUEEN:
        moves = this.getSlidingMoves(state, piece, [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }]);
        break;
      case PieceType.KING:
        moves = this.getKingMoves(state, piece);
        if (!ignoreCheck) {
            moves = [...moves, ...this.getCastlingMoves(state, piece)];
        }
        break;
    }

    if (ignoreCheck) return moves;

    // Filter moves that leave King in check
    return moves.filter(targetPos => {
      const nextState = this.simulateMove(state, { from: pos, to: targetPos, piece });
      return !this.isKingInCheck(nextState, piece.color);
    });
  }

  static getPawnMoves(state: BoardState, piece: Piece): Position[] {
    const moves: Position[] = [];
    const dir = piece.color === Color.WHITE ? -1 : 1;
    const startY = piece.color === Color.WHITE ? 6 : 1;

    // Forward
    const oneStep = { x: piece.pos.x, y: piece.pos.y + dir };
    if (state.cells.has(posToKey(oneStep)) && !this.getPieceAt(state, oneStep)) {
      moves.push(oneStep);
      const twoStep = { x: piece.pos.x, y: piece.pos.y + 2 * dir };
      if (piece.pos.y === startY && state.cells.has(posToKey(twoStep)) && !this.getPieceAt(state, twoStep)) {
        moves.push(twoStep);
      }
    }

    // Captures
    const captures = [{ x: piece.pos.x - 1, y: piece.pos.y + dir }, { x: piece.pos.x + 1, y: piece.pos.y + dir }];
    captures.forEach(c => {
      if (state.cells.has(posToKey(c))) {
        const target = this.getPieceAt(state, c);
        if (target && target.color !== piece.color) {
          moves.push(c);
        }
        // En Passant
        if (!target && state.lastMove && state.lastMove.piece.type === PieceType.PAWN) {
           if (state.lastMove.to.x === c.x && state.lastMove.to.y === piece.pos.y && Math.abs(state.lastMove.from.y - state.lastMove.to.y) === 2) {
               moves.push(c);
           }
        }
      }
    });

    return moves;
  }

  static getSlidingMoves(state: BoardState, piece: Piece, dirs: Position[]): Position[] {
    const moves: Position[] = [];
    dirs.forEach(dir => {
      let cur = { x: piece.pos.x + dir.x, y: piece.pos.y + dir.y };
      while (state.cells.has(posToKey(cur))) {
        const target = this.getPieceAt(state, cur);
        if (!target) {
          moves.push({ ...cur });
        } else {
          if (target.color !== piece.color) moves.push({ ...cur });
          break;
        }
        cur.x += dir.x;
        cur.y += dir.y;
      }
    });
    return moves;
  }

  static getKnightMoves(state: BoardState, piece: Piece): Position[] {
    const diffs = [
      { x: 1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 2 }, { x: -1, y: -2 },
      { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 }
    ];
    return diffs
      .map(d => ({ x: piece.pos.x + d.x, y: piece.pos.y + d.y }))
      .filter(p => state.cells.has(posToKey(p)) && (this.getPieceAt(state, p)?.color !== piece.color));
  }

  static getKingMoves(state: BoardState, piece: Piece): Position[] {
    const diffs = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
    ];
    return diffs
      .map(d => ({ x: piece.pos.x + d.x, y: piece.pos.y + d.y }))
      .filter(p => state.cells.has(posToKey(p)) && (this.getPieceAt(state, p)?.color !== piece.color));
  }

  static getCastlingMoves(state: BoardState, piece: Piece): Position[] {
    if (piece.hasMoved || this.isKingInCheck(state, piece.color)) return [];
    const moves: Position[] = [];

    const rooks = state.pieces.filter(p => p.type === PieceType.ROOK && p.color === piece.color && !p.hasMoved);
    rooks.forEach(rook => {
        const dx = rook.pos.x > piece.pos.x ? 1 : -1;
        let clear = true;
        // Check squares between King and Rook
        for (let x = piece.pos.x + dx; x !== rook.pos.x; x += dx) {
            if (this.getPieceAt(state, { x, y: piece.pos.y })) {
                clear = false;
                break;
            }
            // King cannot pass through square that is under attack
            if (Math.abs(x - piece.pos.x) <= 2) {
                const nextState = this.simulateMove(state, { from: piece.pos, to: { x, y: piece.pos.y }, piece });
                if (this.isKingInCheck(nextState, piece.color)) {
                    clear = false;
                    break;
                }
            }
        }
        if (clear) {
            moves.push({ x: piece.pos.x + 2 * dx, y: piece.pos.y });
        }
    });

    return moves;
  }

  static isKingInCheck(state: BoardState, color: Color): boolean {
    const king = state.pieces.find(p => p.type === PieceType.KING && p.color === color);
    if (!king) return false;

    const opponentColor = color === Color.WHITE ? Color.BLACK : Color.WHITE;
    const opponentPieces = state.pieces.filter(p => p.color === opponentColor);

    for (const p of opponentPieces) {
      const moves = this.getValidMoves(state, p.pos, true);
      if (moves.some(m => m.x === king.pos.x && m.y === king.pos.y)) return true;
    }
    return false;
  }

  static getPieceAt(state: BoardState, pos: Position): Piece | undefined {
    return state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
  }

  static simulateMove(state: BoardState, move: Move): BoardState {
    const newPieces = state.pieces
        .filter(p => !(p.pos.x === move.to.x && p.pos.y === move.to.y)) // Basic capture
        .map(p => {
            if (p.pos.x === move.from.x && p.pos.y === move.from.y) {
                return { ...p, pos: move.to, hasMoved: true };
            }
            return p;
        });
    
    // Handling En Passant
    if (move.piece.type === PieceType.PAWN && move.from.x !== move.to.x && !this.getPieceAt(state, move.to)) {
        const capturedPawnY = move.from.y;
        return {
            ...state,
            pieces: newPieces.filter(p => !(p.pos.x === move.to.x && p.pos.y === capturedPawnY))
        };
    }

    return { ...state, pieces: newPieces };
  }

  static isCheckmate(state: BoardState, color: Color): boolean {
    if (!this.isKingInCheck(state, color)) return false;
    const pieces = state.pieces.filter(p => p.color === color);
    for (const p of pieces) {
        if (this.getValidMoves(state, p.pos).length > 0) return false;
    }
    return true;
  }

  static isStalemate(state: BoardState, color: Color): boolean {
    if (this.isKingInCheck(state, color)) return false;
    const pieces = state.pieces.filter(p => p.color === color);
    for (const p of pieces) {
        if (this.getValidMoves(state, p.pos).length > 0) return false;
    }
    return true;
  }

  static expandBoard(cells: Set<string>): { newCells: Set<string>; addedCount: number } {
    const count = Math.floor(Math.random() * 8) + 1;
    const currentCells = Array.from(cells).map(keyToPos);
    const newCellsSet = new Set(cells);
    let added = 0;

    // Try finding neighbors for expansion
    for (let i = 0; i < 50 && added < count; i++) {
        const randomCell = currentCells[Math.floor(Math.random() * currentCells.length)];
        const neighbors = [
            { x: randomCell.x + 1, y: randomCell.y },
            { x: randomCell.x - 1, y: randomCell.y },
            { x: randomCell.x, y: randomCell.y + 1 },
            { x: randomCell.x, y: randomCell.y - 1 }
        ];
        const target = neighbors[Math.floor(Math.random() * neighbors.length)];
        const key = posToKey(target);
        if (!newCellsSet.has(key)) {
            newCellsSet.add(key);
            added++;
        }
    }

    return { newCells: newCellsSet, addedCount: added };
  }
}
