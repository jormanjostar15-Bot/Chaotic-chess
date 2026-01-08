
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Color, PieceType, Position, Piece, BoardState, Move, PIECE_COSTS } from './types';
import { ChessEngine, posToKey, keyToPos } from './logic/chessLogic';

declare const Peer: any;

const INITIAL_SIZE = 8;
const createInitialState = (): BoardState => {
  const cells = new Set<string>();
  const pieces: Piece[] = [];
  for (let y = 0; y < INITIAL_SIZE; y++) {
    for (let x = 0; x < INITIAL_SIZE; x++) cells.add(`${x},${y}`);
  }
  const pieceOrder = [PieceType.ROOK, PieceType.KNIGHT, PieceType.BISHOP, PieceType.QUEEN, PieceType.KING, PieceType.BISHOP, PieceType.KNIGHT, PieceType.ROOK];
  for (let x = 0; x < 8; x++) {
    pieces.push({ id: `w-p-${x}`, type: PieceType.PAWN, color: Color.WHITE, pos: { x, y: 6 }, hasMoved: false });
    pieces.push({ id: `b-p-${x}`, type: PieceType.PAWN, color: Color.BLACK, pos: { x, y: 1 }, hasMoved: false });
    pieces.push({ id: `w-m-${x}`, type: pieceOrder[x], color: Color.WHITE, pos: { x, y: 7 }, hasMoved: false });
    pieces.push({ id: `b-m-${x}`, type: pieceOrder[x], color: Color.BLACK, pos: { x, y: 0 }, hasMoved: false });
  }
  return { cells, pieces, turn: Color.WHITE, lastMove: null, gold: { [Color.WHITE]: 0, [Color.BLACK]: 0 } };
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
  const [log, setLog] = useState<string[]>(["Добро пожаловать!"]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [shopActive, setShopActive] = useState<PieceType | null>(null);

  // Сетевые состояния
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerId, setRemotePeerId] = useState<string>('');
  const [connection, setConnection] = useState<any>(null);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);
  const peerRef = useRef<any>(null);

  const initPeer = () => {
    if (peerRef.current) {
        peerRef.current.destroy();
    }
    
    setPeerError(null);
    setMyPeerId('');

    try {
      // Конфигурация специально для GitHub Pages и Netlify (HTTPS)
      const peer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1, // Минимум логов для скорости
        config: {
          'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });
      
      peerRef.current = peer;

      peer.on('open', (id: string) => {
        setMyPeerId(id);
      });

      peer.on('connection', (conn: any) => {
        setConnection(conn);
        setMyColor(Color.WHITE);
        setLog(prev => ["Друг подключился! Вы играете за БЕЛЫХ.", ...prev]);
        setupConnection(conn);
      });

      peer.on('error', (err: any) => {
        console.error('Peer error type:', err.type);
        if (err.type === 'network' || err.type === 'server-error') {
          setPeerError('Ошибка сети. Попробуйте обновить 🔄');
        } else if (err.type === 'peer-unavailable') {
          setPeerError('ID друга не найден. Проверьте адрес.');
        } else {
          setPeerError(`Сбой: ${err.type}`);
        }
      });

      peer.on('disconnected', () => {
        peer.reconnect();
      });

    } catch (e) {
      setPeerError('Ошибка запуска P2P');
    }
  };

  useEffect(() => {
    initPeer();
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  const setupConnection = (conn: any) => {
    conn.on('data', (data: any) => {
      if (data.type === 'STATE_UPDATE') {
        const receivedState = data.state;
        receivedState.cells = new Set(data.state.cells);
        setState(receivedState);
        if (data.log) setLog(prev => [data.log, ...prev.slice(0, 10)]);
      }
      if (data.type === 'GAME_OVER') setGameOver(data.message);
    });

    conn.on('close', () => {
        setLog(prev => ["Связь с противником потеряна.", ...prev]);
        setConnection(null);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;
    const conn = peerRef.current.connect(remotePeerId.trim(), {
        reliable: true
    });
    setConnection(conn);
    setMyColor(Color.BLACK);
    setLog(prev => ["Подключаемся к другу... Пожалуйста, подождите.", ...prev]);
    setupConnection(conn);
  };

  const copyId = () => {
    if (!myPeerId) return;
    navigator.clipboard.writeText(myPeerId);
    setLog(prev => ["Ваш ID скопирован!", ...prev]);
  };

  // Экономика
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

  const syncState = (newState: BoardState, message?: string) => {
    if (connection && connection.open) {
      connection.send({
        type: 'STATE_UPDATE',
        state: { ...newState, cells: Array.from(newState.cells) },
        log: message
      });
    }
  };

  const boardBounds = useMemo(() => {
    const coords = Array.from(state.cells).map(keyToPos);
    if (coords.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 1, height: 1 };
    const minX = Math.min(...coords.map(c => c.x));
    const maxX = Math.max(...coords.map(c => c.x));
    const minY = Math.min(...coords.map(c => c.y));
    const maxY = Math.max(...coords.map(c => c.y));
    return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }, [state.cells]);

  const canPlaceAt = (pos: Position, color: Color) => {
    if (color === Color.WHITE) return pos.y >= 2;
    return pos.y <= 5;
  };

  const handleCellClick = (pos: Position) => {
    if (gameOver) return;
    const isMyTurn = state.turn === myColor;

    if (shopActive) {
      if (!state.cells.has(posToKey(pos))) return;
      const hasMyGhost = state.pieces.some(p => p.isGhost && p.color === myColor);
      if (hasMyGhost) return;
      if (!canPlaceAt(pos, myColor!)) return;

      const cost = PIECE_COSTS[shopActive];
      if (state.gold[myColor!] >= cost) {
        const newGhost: Piece = {
          id: `ghost-${Date.now()}`,
          type: shopActive,
          color: myColor!,
          pos,
          hasMoved: false,
          isGhost: true,
          materializeIn: 3
        };
        const newState = {
          ...state,
          pieces: [...state.pieces, newGhost],
          gold: { ...state.gold, [myColor!]: state.gold[myColor!] - cost }
        };
        const msg = `Прообраз ${shopActive} установлен!`;
        setState(newState);
        syncState(newState, msg);
        setLog(prev => [msg, ...prev.slice(0, 10)]);
        setShopActive(null);
      }
      return;
    }

    if (!isMyTurn) return;

    if (selected) {
      const isMove = validMoves.some(m => m.x === pos.x && m.y === pos.y);
      if (isMove) {
        executeMove(selected, pos);
        return;
      }
    }

    const realPiecesOnly = state.pieces.filter(p => !p.isGhost);
    const piece = realPiecesOnly.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
    if (piece && piece.color === myColor) {
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

    let nextRealPieces = realPieces
      .filter(p => !(p.pos.x === to.x && p.pos.y === to.y))
      .map(p => (p.pos.x === from.x && p.pos.y === from.y) ? { ...p, pos: to, hasMoved: true } : p);

    const nextGhosts = ghostPieces.map(g => ({ ...g, materializeIn: (g.materializeIn || 1) - 1 }));
    let finalPieces: Piece[] = [];
    let tempRealPieces = [...nextRealPieces];

    const becomingReal = nextGhosts.filter(g => g.materializeIn <= 0);
    finalPieces.push(...nextGhosts.filter(g => g.materializeIn > 0));

    becomingReal.forEach(g => {
        const captured = tempRealPieces.find(p => p.pos.x === g.pos.x && p.pos.y === g.pos.y);
        if (captured?.type === PieceType.KING) {
            const msg = `${g.color === Color.WHITE ? "БЕЛЫЕ" : "ЧЕРНЫЕ"} ПОБЕДИЛИ!`;
            setGameOver(msg);
            if(connection) connection.send({ type: 'GAME_OVER', message: msg });
        }
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
        const { newCells } = ChessEngine.expandBoard(state.cells);
        nextState.cells = newCells;
    }

    setState(nextState);
    syncState(nextState);
    setSelected(null);
    setValidMoves([]);
  };

  if (!myColor) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 p-6">
        <div className="bg-zinc-900 p-8 rounded-2xl border border-zinc-800 shadow-2xl max-w-md w-full text-center">
          <h1 className="text-3xl font-black text-white mb-2 tracking-tighter italic">Chaotic Chess</h1>
          <p className="text-zinc-500 mb-8 text-[10px] uppercase font-bold tracking-[0.2em]">P2P Battle on GitHub Pages</p>
          
          <div className="space-y-6">
            <div className={`bg-zinc-800 p-5 rounded-xl border transition-all ${peerError ? 'border-red-900/50' : 'border-zinc-700'}`}>
              <p className="text-[10px] font-bold text-zinc-500 uppercase mb-3">Ваш секретный код:</p>
              <div className="flex items-center gap-3">
                <p className={`flex-grow font-mono text-sm text-left break-all ${peerError ? 'text-red-400' : 'text-yellow-500'}`}>
                  {peerError ? peerError : (myPeerId || 'Создание комнаты...')}
                </p>
                {myPeerId && !peerError && (
                  <button onClick={copyId} className="bg-zinc-700 hover:bg-zinc-600 p-2 rounded-lg text-xs transition-colors">📋</button>
                )}
                {peerError && (
                  <button onClick={initPeer} className="bg-red-600 hover:bg-red-500 p-2 rounded-lg text-xs text-white">🔄</button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase text-left">Вставьте код друга:</p>
              <input 
                type="text" 
                value={remotePeerId} 
                onChange={(e) => setRemotePeerId(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 p-4 rounded-xl text-white font-mono text-sm focus:ring-2 ring-blue-500 outline-none w-full"
                placeholder="Код от друга..."
              />
              <button 
                onClick={connectToPeer}
                disabled={!myPeerId || !!peerError}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-black py-4 rounded-xl transition-all shadow-lg active:scale-95 text-sm uppercase tracking-widest"
              >
                Начать битву
              </button>
            </div>
            
            <div className="p-4 bg-zinc-800/30 rounded-xl text-left border border-zinc-800/50">
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                <strong className="text-zinc-400">Совет:</strong> Если игра не находит друга, убедитесь, что вы оба используете <code className="text-blue-400">https://</code> в начале адреса страницы.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen p-4 gap-4 overflow-hidden select-none bg-zinc-950">
      <div className={`flex-grow bg-zinc-900 rounded-2xl border border-zinc-800 relative overflow-hidden flex items-center justify-center p-8 ${shopActive ? 'cursor-crosshair bg-blue-900/5' : ''}`}>
        <div 
          className="grid gap-px bg-zinc-800 p-px shadow-2xl transition-all duration-500 rounded-sm overflow-hidden"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${boardBounds.height}, minmax(0, 1fr))`,
            aspectRatio: `${boardBounds.width} / ${boardBounds.height}`,
            maxHeight: '95%', maxWidth: '95%'
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
                  const canPlace = shopActive && canPlaceAt({x, y}, myColor!);

                  if (!exists) return <div key={key} className="bg-zinc-950/10" />;

                  return (
                    <div
                      key={key}
                      onClick={() => handleCellClick({ x, y })}
                      className={`
                        relative cursor-pointer transition-all duration-200 flex items-center justify-center text-3xl md:text-5xl
                        ${isDark ? 'bg-zinc-700/80' : 'bg-zinc-300'}
                        ${isSelected ? 'bg-yellow-400 ring-4 ring-yellow-500/50 z-20' : ''}
                        ${isValid ? 'hover:bg-green-400/80 bg-green-500/20' : ''}
                        ${shopActive && exists ? (canPlace ? 'hover:bg-blue-400/50 bg-blue-500/10' : 'hover:bg-red-500/50 cursor-not-allowed') : ''}
                      `}
                    >
                      {ghost && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-40 animate-pulse">
                          <span className={`${ghost.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} scale-75`}>
                            {PIECE_ICONS[ghost.type][ghost.color]}
                          </span>
                          <div className="absolute top-1 right-1 w-4 h-4 bg-blue-600 text-white text-[8px] flex items-center justify-center rounded-full font-black shadow-lg">
                            {ghost.materializeIn}
                          </div>
                        </div>
                      )}
                      {piece && (
                        <span className={`${piece.color === Color.WHITE ? 'text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]' : 'text-zinc-900'} z-10 select-none`}>
                          {PIECE_ICONS[piece.type][piece.color]}
                        </span>
                      )}
                      {isValid && !piece && (
                        <div className="w-4 h-4 rounded-full bg-zinc-950/20" />
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        {gameOver && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl text-center p-6">
            <div className="bg-zinc-900 p-10 rounded-3xl border border-zinc-700 shadow-[0_0_50px_rgba(0,0,0,0.5)] max-w-sm w-full">
              <h2 className="text-4xl font-black text-yellow-500 mb-2 italic">ФИНАЛ</h2>
              <p className="text-zinc-400 mb-8 uppercase tracking-widest font-bold">{gameOver}</p>
              <button onClick={() => window.location.reload()} className="w-full bg-white text-black py-4 rounded-2xl font-black hover:bg-zinc-200 transition-transform active:scale-95">НОВАЯ ИГРА</button>
            </div>
          </div>
        )}
      </div>

      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl">
           <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Ваша роль</p>
           <div className="flex items-center justify-between">
             <p className={`text-2xl font-black ${myColor === Color.WHITE ? 'text-white' : 'text-zinc-500'}`}>
               {myColor === Color.WHITE ? 'БЕЛЫЕ ⚪' : 'ЧЕРНЫЕ ⚫'}
             </p>
             <div className={`h-3 w-3 rounded-full ${connection?.open ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-pulse'}`}></div>
           </div>
           <div className="mt-4 pt-4 border-t border-zinc-800/50">
             <p className={`text-sm font-black uppercase tracking-tighter ${state.turn === myColor ? 'text-green-500' : 'text-zinc-600'}`}>
               {state.turn === myColor ? '● Ваш ход' : '○ Ход противника'}
             </p>
           </div>
        </div>

        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl flex items-center justify-between">
           <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">🪙 Золото</p>
           <p className="text-yellow-500 font-mono text-3xl font-black tracking-tighter">{state.gold[myColor!].toFixed(1)}</p>
        </div>

        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-xl">
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-4">Магазин (3 хода на появление)</p>
          <div className="grid grid-cols-5 md:grid-cols-2 gap-2">
            {[
              { type: PieceType.PAWN, cost: 1 },
              { type: PieceType.KNIGHT, cost: 3 },
              { type: PieceType.BISHOP, cost: 3 },
              { type: PieceType.ROOK, cost: 5 },
              { type: PieceType.QUEEN, cost: 9 },
            ].map(({ type, cost }) => (
              <button
                key={type}
                disabled={state.gold[myColor!] < cost || state.pieces.some(p => p.isGhost && p.color === myColor)}
                onClick={() => setShopActive(type)}
                className={`
                  p-3 rounded-xl border transition-all flex flex-col items-center justify-center gap-1
                  ${shopActive === type ? 'bg-blue-600 border-blue-400 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'}
                  disabled:opacity-20 disabled:grayscale
                `}
              >
                <span className="text-2xl md:text-3xl">{PIECE_ICONS[type][myColor!]}</span>
                <span className="text-[10px] text-yellow-500 font-black">{cost}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-grow bg-zinc-900 p-4 rounded-2xl border border-zinc-800 flex flex-col overflow-hidden shadow-xl">
          <div className="flex-grow overflow-y-auto space-y-1 pr-2 custom-scrollbar">
            {log.map((entry, i) => (
              <div key={i} className="text-[10px] font-mono p-2 rounded-lg bg-zinc-950/50 text-zinc-500 border-l-2 border-zinc-700 leading-tight">
                {entry}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
