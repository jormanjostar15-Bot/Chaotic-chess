
export enum Color {
  WHITE = 'white',
  BLACK = 'black'
}

export enum PieceType {
  PAWN = 'pawn',
  ROOK = 'rook',
  KNIGHT = 'knight',
  BISHOP = 'bishop',
  QUEEN = 'queen',
  KING = 'king'
}

export interface Position {
  x: number;
  y: number;
}

export interface Piece {
  id: string;
  type: PieceType;
  color: Color;
  pos: Position;
  hasMoved: boolean;
  isGhost?: boolean;
  materializeIn?: number; // Number of turns left
}

export interface Move {
  from: Position;
  to: Position;
  piece: Piece;
  captured?: Piece;
  isEnPassant?: boolean;
  isCastling?: boolean;
  promotion?: PieceType;
}

export interface BoardState {
  cells: Set<string>; // "x,y" format
  pieces: Piece[];
  turn: Color;
  lastMove: Move | null;
  gold: Record<Color, number>;
}

export const PIECE_COSTS: Record<PieceType, number> = {
  [PieceType.PAWN]: 1,
  [PieceType.KNIGHT]: 3,
  [PieceType.BISHOP]: 3,
  [PieceType.ROOK]: 5,
  [PieceType.QUEEN]: 9,
  [PieceType.KING]: 0 // Cannot be bought
};
