
import React, { useState, useMemo, useEffect } from 'react';
import { Color, PieceType, Position, Piece, BoardState, Move, PIECE_COSTS } from './types';
import { ChessEngine, posToKey, keyToPos } from './logic/chessLogic';

const INITIAL_SIZE = 8;
const createInitialState = (): BoardState => {
  const cells = new Set<string>();
  const pieces: Piece[] = [];

  for (let y = 0; y < INITIAL_SIZE; y++) {
    for (let x = 0; x < INITIAL_SIZE; x++) {
      cells.add(`${x},${y}`);
    }
  }

  const pieceOrder = [
    PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN,
    PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK
  ];

  for (let x = 0; x < 8; x++) {
    pieces.push({ id: `w-p-${x}`, type: PieceType.PAWN, color: Color.WHITE, pos: { x, y: 6 }, hasMoved: false });
    pieces.push({ id: `b-p-${x}`, type: PieceType.PAWN, color: Color.BLACK, pos: { x, y: 1 }, hasMoved: false });
    pieces.push({ id: `w-m-${x}`, type: pieceOrder[x], color: Color.WHITE, pos: { x, y: 7 }, hasMoved: false });
    pieces.push({ id: `b-m-${x}`, type: pieceOrder[x], color: Color.BLACK, pos: { x, y: 0 }, hasMoved: false });
  }

  return { 
    cells, 
    pieces, 
    turn: Color.WHITE, 
    lastMove: null,
    gold: { [Color.WHITE]: 0, [Color.BLACK]: 0 }
  };
};

const PIECE_ICONS: Record<PieceType, Record<Color, string>> = {
  [PieceType.PAWN]: { [Color.WHITE]: '♙', [Color.BLACK]: '♟' },
  [PieceType.ROOK]: { [Color.WHITE]: '♖', [Color.BLACK]: '♜' },
  [PieceType.KNIGHT]: { [Color.WHITE]: '♘', [Color.BLACK]: '♞' },
  [PieceType.BISHOP]: { [Color.WHITE]: '♗', [Color.BLACK]: '♝' },
  [PieceType.QUEEN]: { [Color.WHITE]: '♕', [Color.BLACK]: '♛' },
  [PieceType.KING]: { [Color.WHITE]: '♔', [Color.BLACK]: '♚' },
};

export default function App() {
  const [state, setState] = useState<BoardState>(createInitialState());
  const [selected, setSelected] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Position[]>([]);
  const [log, setLog] = useState<string[]>(["Игра началась!"]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [shopActive, setShopActive] = useState<PieceType | null>(null);

  // Экономика: +0.25 монет каждые 8 секунд обоим игрокам
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => ({
        ...prev,
        gold: {
          [Color.WHITE]: prev.gold[Color.WHITE] + 0.25,
          [Color.BLACK]: prev.gold[Color.BLACK] + 0.25,
        }
      }));
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const boardBounds = useMemo(() => {
    const coords = Array.from(state.cells).map(keyToPos);
    const minX = Math.min(...coords.map(c => c.x));
    const maxX = Math.max(...coords.map(c => c.x));
    const minY = Math.min(...coords.map(c => c.y));
    const maxY = Math.max(...coords.map(c => c.y));
    return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }, [state.cells]);

  const canPlaceAt = (pos: Position, color: Color) => {
    // Белые ставят не выше 6-й линии (y >= 6 или y <= 7? В шахматах 6-я линия это y=2, но тут 0 вверху)
    // Ориентируемся на визуальные координаты: Белые (снизу) стартуют на y=6,7. 
    // "Не выше 6 линии" для белых обычно означает зону их половины.
    // Условие: Белые (белые клетки снизу): y >= 3. Черные (сверху): y <= 4. 
    // Исходя из вашего запроса: Белые не выше 6-й линии (в шахматной нотации), в координатах массива это y >= 2.
    // Черные не ниже 3-й (в нотации), в координатах это y <= 5.
    if (color === Color.WHITE) return pos.y >= 2;
    return pos.y <= 5;
  };

  const handleCellClick = (pos: Position) => {
    if (gameOver) return;

    // Режим установки купленной фигуры
    if (shopActive) {
      if (!state.cells.has(posToKey(pos))) return;
      
      // Проверка: нет ли уже прообраза ЭТОГО игрока на поле
      const hasMyGhost = state.pieces.some(p => p.isGhost && p.color === state.turn);
      if (hasMyGhost) {
        setLog(prev => [`У вас уже есть один прообраз в процессе материализации!`, ...prev.slice(0, 5)]);
        setShopActive(null);
        return;
      }

      if (!canPlaceAt(pos, state.turn)) {
        setLog(prev => ["Недопустимая линия для установки!", ...prev.slice(0, 5)]);
        return;
      }

      const cost = PIECE_COSTS[shopActive];
      if (state.gold[state.turn] >= cost) {
        const newGhost: Piece = {
          id: `ghost-${Date.now()}`,
          type: shopActive,
          color: state.turn,
          pos,
          hasMoved: false,
          isGhost: true,
          materializeIn: 3
        };
        
        setState(prev => ({
          ...prev,
          pieces: [...prev.pieces, newGhost],
          gold: { ...prev.gold, [prev.turn]: prev.gold[prev.turn] - cost }
        }));
        setLog(prev => [`Установлен прообраз ${shopActive}. Появится через 3 хода.`, ...prev.slice(0, 10)]);
        setShopActive(null);
      }
      return;
    }

    if (selected) {
      const isMove = validMoves.some(m => m.x === pos.x && m.y === pos.y);
      if (isMove) {
        executeMove(selected, pos);
        return;
      }
    }

    const realPiecesOnly = state.pieces.filter(p => !p.isGhost);
    const piece = realPiecesOnly.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
    
    if (piece && piece.color === state.turn) {
      setSelected(pos);
      setValidMoves(ChessEngine.getValidMoves({ ...state, pieces: realPiecesOnly }, pos));
    } else {
      setSelected(null);
      setValidMoves([]);
    }
  };

  const executeMove = (from: Position, to: Position) => {
    let currentPieces = [...state.pieces];
    const realPieces = currentPieces.filter(p => !p.isGhost);
    const ghostPieces = currentPieces.filter(p => p.isGhost);

    const activePiece = realPieces.find(p => p.pos.x === from.x && p.pos.y === from.y)!;
    const targetPiece = realPieces.find(p => p.pos.x === to.x && p.pos.y === to.y);

    // 1. Обычный ход
    let nextRealPieces = realPieces
      .filter(p => !(p.pos.x === to.x && p.pos.y === to.y))
      .map(p => (p.pos.x === from.x && p.pos.y === from.y) ? { ...p, pos: to, hasMoved: true } : p);

    // Спец. правила хода
    if (activePiece.type === PieceType.PAWN && from.x !== to.x && !targetPiece) {
        nextRealPieces = nextRealPieces.filter(p => !(p.pos.x === to.x && p.pos.y === from.y));
    }
    if (activePiece.type === PieceType.KING && Math.abs(from.x - to.x) === 2) {
        const dx = to.x > from.x ? 1 : -1;
        const rook = realPieces.find(p => p.type === PieceType.ROOK && p.color === activePiece.color && !p.hasMoved && (dx === 1 ? p.pos.x > from.x : p.pos.x < from.x));
        if (rook) nextRealPieces = nextRealPieces.map(p => p.id === rook.id ? { ...p, pos: { x: to.x - dx, y: to.y }, hasMoved: true } : p);
    }
    const verticalCells = Array.from(state.cells).map(keyToPos).filter(c => c.x === to.x);
    const extremeY = activePiece.color === Color.WHITE ? Math.min(...verticalCells.map(c => c.y)) : Math.max(...verticalCells.map(c => c.y));
    if (activePiece.type === PieceType.PAWN && to.y === extremeY) {
        nextRealPieces = nextRealPieces.map(p => (p.pos.x === to.x && p.pos.y === to.y) ? { ...p, type: PieceType.QUEEN } : p);
    }

    // 2. Обработка прообразов (Ghost materialization)
    let finalPieces: Piece[] = [];
    let gameEndedByGhost = false;

    const nextGhosts = ghostPieces.map(g => ({ ...g, materializeIn: (g.materializeIn || 1) - 1 }));
    
    // Оставляем те, что еще не проявились
    finalPieces.push(...nextGhosts.filter(g => g.materializeIn > 0));

    // Проявляем те, у кого счетчик 0
    const becomingReal = nextGhosts.filter(g => g.materializeIn <= 0);
    
    let tempRealPieces = [...nextRealPieces];
    becomingReal.forEach(g => {
        const captured = tempRealPieces.find(p => p.pos.x === g.pos.x && p.pos.y === g.pos.y);
        if (captured?.type === PieceType.KING) {
            setGameOver(`${g.color === Color.WHITE ? "БЕЛЫЕ" : "ЧЕРНЫЕ"} ПОБЕДИЛИ (Король съеден прообразом!)`);
            gameEndedByGhost = true;
        }
        // Удаляем любую фигуру на этой клетке
        tempRealPieces = tempRealPieces.filter(p => !(p.pos.x === g.pos.x && p.pos.y === g.pos.y));
        tempRealPieces.push({ ...g, isGhost: false, materializeIn: undefined });
    });

    finalPieces.push(...tempRealPieces);

    const nextTurn = state.turn === Color.WHITE ? Color.BLACK : Color.WHITE;
    let nextState: BoardState = {
      ...state,
      pieces: finalPieces,
      turn: nextTurn,
      lastMove: { from, to, piece: activePiece, captured: targetPiece }
    };

    if (Math.random() < 0.05) {
        const { newCells, addedCount } = ChessEngine.expandBoard(state.cells);
        nextState.cells = newCells;
        setLog(prev => [`Хаос! Клеток добавлено: ${addedCount}`, ...prev.slice(0, 10)]);
    }

    if (!gameEndedByGhost) {
        const engineCheckState = { ...nextState, pieces: tempRealPieces };
        if (ChessEngine.isCheckmate(engineCheckState, nextTurn)) {
            setGameOver(`${state.turn === Color.WHITE ? "БЕЛЫЕ" : "ЧЕРНЫЕ"} ПОБЕДИЛИ!`);
        } else if (ChessEngine.isStalemate(engineCheckState, nextTurn)) {
            setGameOver(`НИЧЬЯ (Пат)!`);
        }
    }

    setState(nextState);
    setSelected(null);
    setValidMoves([]);
  };

  const resetGame = () => {
    setState(createInitialState());
    setSelected(null);
    setValidMoves([]);
    setLog(["Игра сброшена."]);
    setGameOver(null);
    setShopActive(null);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen p-4 gap-4 overflow-hidden select-none">
      <div className={`flex-grow bg-zinc-900 rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center p-8 ${shopActive ? 'cursor-crosshair bg-blue-900/10' : ''}`}>
        <div 
          className="grid gap-px bg-zinc-800 p-px shadow-2xl transition-all duration-500"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${boardBounds.height}, minmax(0, 1fr))`,
            aspectRatio: `${boardBounds.width} / ${boardBounds.height}`,
            maxHeight: '90%', maxWidth: '90%'
          }}
        >
          {Array.from({ length: boardBounds.height }).map((_, rowIdx) => {
            const y = boardBounds.minY + rowIdx;
            return (
              <React.Fragment key={`row-${y}`}>
                {Array.from({ length: boardBounds.width }).map((_, colIdx) => {
                  const x = boardBounds.minX + colIdx;
                  const key = posToKey({ x, y });
                  const exists = state.cells.has(key);
                  const piece = state.pieces.find(p => !p.isGhost && p.pos.x === x && p.pos.y === y);
                  const ghost = state.pieces.find(p => p.isGhost && p.pos.x === x && p.pos.y === y);
                  const isSelected = selected?.x === x && selected?.y === y;
                  const isValid = validMoves.some(m => m.x === x && m.y === y);
                  const isDark = (x + y) % 2 !== 0;
                  const canPlace = shopActive && canPlaceAt({x, y}, state.turn);

                  if (!exists) return <div key={key} className="bg-zinc-950/20" />;

                  return (
                    <div
                      key={key}
                      onClick={() => handleCellClick({ x, y })}
                      className={`
                        relative cursor-pointer transition-colors duration-200 flex items-center justify-center text-3xl md:text-5xl
                        ${isDark ? 'bg-zinc-700' : 'bg-zinc-300'}
                        ${isSelected ? 'ring-4 ring-yellow-400 z-20' : ''}
                        ${isValid ? 'hover:bg-green-400' : ''}
                        ${shopActive && exists ? (canPlace ? 'hover:bg-blue-400/50' : 'hover:bg-red-400/50 cursor-not-allowed') : ''}
                      `}
                    >
                      {ghost && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-40 animate-pulse">
                          <span className={`${ghost.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} scale-75`}>
                            {PIECE_ICONS[ghost.type][ghost.color]}
                          </span>
                          <span className="absolute top-0 right-0 text-[10px] bg-blue-600 text-white px-1 rounded-full font-bold">
                            {ghost.materializeIn}
                          </span>
                        </div>
                      )}
                      {piece && (
                        <span className={`${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} drop-shadow-md z-10`}>
                          {PIECE_ICONS[piece.type][piece.color]}
                        </span>
                      )}
                      {isValid && (
                        <div className="absolute inset-0 flex items-center justify-center z-30">
                          <div className={`w-3 h-3 md:w-4 md:h-4 rounded-full ${piece ? 'bg-red-500/60' : 'bg-zinc-900/20'}`} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        {gameOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="bg-zinc-900 p-8 rounded-2xl border border-zinc-700 text-center shadow-2xl max-w-sm">
              <h2 className="text-3xl font-black text-yellow-500 mb-6">{gameOver}</h2>
              <button onClick={resetGame} className="w-full bg-yellow-500 text-black py-3 rounded-xl font-bold hover:bg-yellow-400 transition-colors">НОВАЯ ИГРА</button>
            </div>
          </div>
        )}
      </div>

      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <span className={`text-lg font-black tracking-tighter ${state.turn === Color.WHITE ? 'text-white' : 'text-zinc-400'}`}>
              ХОД {state.turn === Color.WHITE ? 'БЕЛЫХ' : 'ЧЕРНЫХ'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-800 p-2 rounded-lg border border-zinc-700">
              <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">Золото Белых</p>
              <p className="text-yellow-500 font-mono text-lg font-bold">🪙 {state.gold[Color.WHITE].toFixed(2)}</p>
            </div>
            <div className="bg-zinc-800 p-2 rounded-lg border border-zinc-700">
              <p className="text-[9px] text-zinc-500 font-bold uppercase mb-1">Золото Черных</p>
              <p className="text-yellow-500 font-mono text-lg font-bold">🪙 {state.gold[Color.BLACK].toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg">
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-3">Арсенал (Магазин)</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { type: PieceType.PAWN, cost: 1, label: 'Пешка' },
              { type: PieceType.KNIGHT, cost: 3, label: 'Конь' },
              { type: PieceType.BISHOP, cost: 3, label: 'Слон' },
              { type: PieceType.ROOK, cost: 5, label: 'Ладья' },
              { type: PieceType.QUEEN, cost: 9, label: 'Ферзь' },
            ].map(({ type, cost, label }) => (
              <button
                key={type}
                disabled={state.gold[state.turn] < cost || state.pieces.some(p => p.isGhost && p.color === state.turn)}
                onClick={() => setShopActive(type)}
                className={`
                  p-2 rounded-lg border transition-all flex flex-col items-center
                  ${shopActive === type ? 'bg-blue-600 border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'}
                  disabled:opacity-25 disabled:cursor-not-allowed
                `}
              >
                <span className="text-2xl">{PIECE_ICONS[type][state.turn]}</span>
                <span className="text-[9px] font-bold uppercase mt-1">{label}</span>
                <span className="text-xs text-yellow-500 font-mono font-bold">{cost}</span>
              </button>
            ))}
          </div>
          {shopActive && (
            <button onClick={() => setShopActive(null)} className="w-full mt-3 py-2 bg-red-900/30 text-red-400 rounded-lg text-[10px] uppercase font-bold border border-red-900/50 hover:bg-red-900/50">
              Отменить покупку
            </button>
          )}
        </div>

        <div className="flex-grow bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex flex-col overflow-hidden shadow-lg">
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">Хроника</p>
          <div className="flex-grow overflow-y-auto space-y-1 font-mono text-[10px]">
            {log.map((entry, i) => (
              <div key={i} className={`p-2 rounded bg-zinc-800/40 border-l-2 ${entry.includes('Хаос') ? 'border-orange-500 text-orange-300' : 'border-zinc-600 text-zinc-400'}`}>
                {entry}
              </div>
            ))}
          </div>
        </div>

        <button onClick={resetGame} className="py-3 bg-zinc-800 hover:bg-red-900/20 hover:text-red-400 transition-all text-zinc-500 text-[10px] font-black rounded-xl uppercase border border-zinc-700">
          Сдаться / Рестарт
        </button>
      </div>
    </div>
  );
}
