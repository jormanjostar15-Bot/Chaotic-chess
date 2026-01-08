
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

const generateShortId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export default function App() {
  const [state, setState] = useState<BoardState>(createInitialState());
  const [selected, setSelected] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Position[]>([]);
  const [log, setLog] = useState<string[]>(["Добро пожаловать!"]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const [shopActive, setShopActive] = useState<PieceType | null>(null);

  const [isPeerLibReady, setIsPeerLibReady] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerId, setRemotePeerId] = useState<string>('');
  const [connection, setConnection] = useState<any>(null);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const peerRef = useRef<any>(null);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const checkPeer = setInterval(() => {
      if (typeof Peer !== 'undefined') {
        setIsPeerLibReady(true);
        clearInterval(checkPeer);
      }
    }, 100);
    return () => clearInterval(checkPeer);
  }, []);

  const initPeer = () => {
    if (typeof Peer === 'undefined') return;
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    setPeerError(null);

    const peer = new Peer(generateShortId(), {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      debug: 1,
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
      setPeerError(null);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    });

    peer.on('connection', (conn: any) => {
      // If we are already in game, don't allow new connections unless closed
      if (connection && connection.open) {
        conn.close();
        return;
      }
      setConnection(conn);
      setMyColor(Color.WHITE);
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
      console.error('PeerJS Error:', err.type, err);
      const errorMsg = `Ошибка: ${err.type}`;
      
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'disconnected') {
        setPeerError('Проблема с сетью. Переподключение...');
        if (!retryTimerRef.current) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            initPeer();
          }, 3000);
        }
      } else {
        setPeerError(errorMsg);
      }
    });

    peer.on('disconnected', () => {
      setPeerError('Потеряна связь с сервером. Восстановление...');
      peer.reconnect();
    });
  };

  useEffect(() => {
    if (isPeerLibReady) initPeer();
    return () => {
      peerRef.current?.destroy();
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, [isPeerLibReady]);

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnected(true);
      setPeerError(null);
      setLog(prev => ["Связь с игроком установлена!", ...prev]);
      
      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (conn.open) {
          conn.send({ type: 'HEARTBEAT' });
        } else {
          clearInterval(heartbeat);
        }
      }, 5000);

      if (myColor === Color.WHITE) {
        conn.send({ 
          type: 'STATE_UPDATE', 
          state: { ...state, cells: Array.from(state.cells) } 
        });
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'HEARTBEAT') return;
      
      if (data.type === 'STATE_UPDATE') {
        const receivedState = { ...data.state, cells: new Set(data.state.cells) };
        setState(receivedState);
        if (data.log) setLog(prev => [data.log, ...prev.slice(0, 15)]);
      }
      if (data.type === 'GAME_OVER') setGameOver(data.message);
    });

    conn.on('close', () => {
      setIsConnected(false);
      setLog(prev => ["Соединение закрыто. Ожидание игрока...", ...prev]);
      setConnection(null);
    });

    conn.on('error', (err: any) => {
      console.error("Connection error:", err);
      setIsConnected(false);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current || !peerRef.current.open) {
      setPeerError("Peer не готов или ID пуст");
      return;
    }
    const conn = peerRef.current.connect(remotePeerId.trim().toUpperCase(), { 
      reliable: true,
      connectionPriority: 'high'
    });
    setConnection(conn);
    setMyColor(Color.BLACK);
    setupConnection(conn);
  };

  // Экономика
  useEffect(() => {
    if (!isConnected || gameOver) return;
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
  }, [isConnected, gameOver]);

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

  const executeMove = (from: Position, to: Position) => {
    const activePiece = state.pieces.find(p => p.pos.x === from.x && p.pos.y === from.y)!;
    const targetPiece = state.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);

    let nextPieces = state.pieces
      .filter(p => !(p.pos.x === to.x && p.pos.y === to.y))
      .map(p => (p.pos.x === from.x && p.pos.y === from.y) ? { ...p, pos: to, hasMoved: true } : p);

    const nextTurn = state.turn === Color.WHITE ? Color.BLACK : Color.WHITE;
    let newState: BoardState = {
      ...state,
      pieces: nextPieces,
      turn: nextTurn,
      lastMove: { from, to, piece: activePiece, captured: targetPiece }
    };

    if (Math.random() < 0.1) {
      const { newCells } = ChessEngine.expandBoard(state.cells);
      newState.cells = newCells;
    }

    if (targetPiece?.type === PieceType.KING) {
      const winMsg = `${myColor === Color.WHITE ? "БЕЛЫЕ" : "ЧЕРНЫЕ"} ВЗЯЛИ КОРОЛЯ!`;
      setGameOver(winMsg);
      if (connection?.open) connection.send({ type: 'GAME_OVER', message: winMsg });
    }

    setState(newState);
    syncState(newState);
    setSelected(null);
    setValidMoves([]);
  };

  const handleCellClick = (pos: Position) => {
    if (gameOver || state.turn !== myColor || !isConnected) return;

    if (shopActive) {
      const cost = PIECE_COSTS[shopActive];
      if (state.gold[myColor] >= cost) {
        const newPiece: Piece = {
          id: `buy-${Date.now()}`,
          type: shopActive,
          color: myColor,
          pos,
          hasMoved: false
        };
        const newState = {
          ...state,
          pieces: [...state.pieces, newPiece],
          gold: { ...state.gold, [myColor]: state.gold[myColor] - cost }
        };
        setState(newState);
        syncState(newState, `Куплен ${shopActive}`);
        setShopActive(null);
      }
      return;
    }

    const piece = state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
    if (selected) {
      if (validMoves.some(m => m.x === pos.x && m.y === pos.y)) {
        executeMove(selected, pos);
        return;
      }
    }

    if (piece && piece.color === myColor) {
      setSelected(pos);
      setValidMoves(ChessEngine.getValidMoves(state, pos));
    } else {
      setSelected(null);
      setValidMoves([]);
    }
  };

  if (!isPeerLibReady) return <div className="h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">ЗАГРУЗКА ПЛАТФОРМЫ...</div>;

  if (!myColor) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 p-6">
        <div className="bg-zinc-900 p-8 rounded-2xl border border-zinc-800 shadow-2xl max-w-md w-full text-center">
          <h1 className="text-3xl font-black text-white mb-6 italic tracking-tighter">Chaotic Chess</h1>
          <div className="space-y-4">
            <div className={`bg-zinc-800 p-4 rounded-xl border ${peerError ? 'border-red-500' : 'border-zinc-700'}`}>
              <p className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Ваш Код:</p>
              <p className="text-xl font-mono text-yellow-500 font-bold">{myPeerId || 'ГЕНЕРАЦИЯ...'}</p>
              {peerError && <p className="text-[9px] text-red-400 mt-2 uppercase">{peerError}</p>}
            </div>
            <input 
              type="text" 
              placeholder="КОД ДРУГА"
              value={remotePeerId}
              onChange={(e) => setRemotePeerId(e.target.value.toUpperCase())}
              className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-xl text-white font-mono text-center focus:ring-2 ring-blue-500 outline-none"
            />
            <button 
              onClick={connectToPeer} 
              disabled={!myPeerId}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 rounded-xl transition-all active:scale-95"
            >
              ИГРАТЬ ПО СЕТИ
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 mt-6 uppercase tracking-widest">P2P Battle Engine v1.1</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-screen p-4 gap-4 bg-zinc-950 text-white overflow-hidden">
      <div className="flex-grow bg-zinc-900 rounded-2xl border border-zinc-800 relative flex items-center justify-center overflow-auto custom-scrollbar">
        <div 
          className="grid gap-px bg-zinc-800 p-px shadow-2xl transition-all duration-500"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, 50px)`,
            gridTemplateRows: `repeat(${boardBounds.height}, 50px)`,
          }}
        >
          {Array.from({ length: boardBounds.height }).map((_, r) => {
            const y = boardBounds.minY + r;
            return Array.from({ length: boardBounds.width }).map((_, c) => {
              const x = boardBounds.minX + c;
              const key = posToKey({x,y});
              const exists = state.cells.has(key);
              const piece = state.pieces.find(p => p.pos.x === x && p.pos.y === y);
              const isSelected = selected?.x === x && selected?.y === y;
              const isValid = validMoves.some(m => m.x === x && m.y === y);

              if (!exists) return <div key={key} className="w-[50px] h-[50px] bg-zinc-950/20" />;

              return (
                <div 
                  key={key}
                  onClick={() => handleCellClick({x,y})}
                  className={`
                    w-[50px] h-[50px] flex items-center justify-center text-3xl cursor-pointer transition-all duration-200
                    ${(x+y)%2 === 0 ? 'bg-zinc-200 hover:bg-zinc-100' : 'bg-zinc-700 hover:bg-zinc-600'}
                    ${isSelected ? 'ring-4 ring-yellow-400 z-10 scale-105 shadow-xl' : ''}
                    ${isValid ? 'relative after:absolute after:w-3 after:h-3 after:bg-green-500/60 after:rounded-full' : ''}
                  `}
                >
                  {piece && (
                    <span 
                      className={`
                        ${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} 
                        drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] transform transition-transform hover:scale-110
                      `}
                    >
                      {PIECE_ICONS[piece.type][piece.color]}
                    </span>
                  )}
                </div>
              );
            });
          })}
        </div>

        {gameOver && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-50">
            <h2 className="text-5xl font-black text-yellow-500 mb-4 italic animate-bounce">КОНЕЦ ИГРЫ</h2>
            <p className="text-white mb-8 font-bold text-xl">{gameOver}</p>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-12 py-4 rounded-full font-black hover:bg-yellow-400 transition-colors">НОВАЯ ИГРА</button>
          </div>
        )}

        {peerError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-600 px-4 py-2 rounded-full text-[10px] font-bold z-50 animate-pulse uppercase">
            {peerError}
          </div>
        )}
      </div>

      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">Сетевой Статус</span>
            <div className={`flex items-center gap-2`}>
              <span className="text-[9px] uppercase font-bold text-zinc-600">{isConnected ? 'ONLINE' : 'WAITING'}</span>
              <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
            </div>
          </div>
          <p className="text-xl font-black">{myColor === Color.WHITE ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}</p>
          <p className={`text-xs mt-1 ${state.turn === myColor ? 'text-green-500 font-bold' : 'text-zinc-500'}`}>
            {state.turn === myColor ? '● Ваш ход' : '○ Ход противника'}
          </p>
        </div>

        <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Ваша Казна</p>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-mono text-yellow-500 font-black">{state.gold[myColor!].toFixed(1)}</p>
            <span className="text-xs text-yellow-600 font-bold">G</span>
          </div>
        </div>

        <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 flex flex-col gap-3">
          <p className="text-[10px] font-bold text-zinc-500 uppercase">Магазин Фигур</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(PIECE_COSTS).filter(([t]) => t !== 'king').map(([type, cost]) => (
              <button 
                key={type}
                onClick={() => setShopActive(shopActive === type ? null : type as PieceType)}
                disabled={state.gold[myColor!] < cost || state.turn !== myColor || !isConnected}
                className={`p-2 rounded-xl border text-xs flex flex-col items-center gap-1 transition-all ${shopActive === type ? 'bg-blue-600 border-blue-400 scale-105 shadow-lg' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'} disabled:opacity-30 disabled:grayscale`}
              >
                <span className="text-2xl">{PIECE_ICONS[type as PieceType][myColor!]}</span>
                <span className="font-bold text-yellow-500">{cost} G</span>
              </button>
            ))}
          </div>
          {shopActive && <p className="text-[9px] text-blue-400 font-bold text-center uppercase animate-pulse">Выберите клетку на поле</p>}
        </div>

        <div className="flex-grow bg-zinc-900 p-4 rounded-2xl border border-zinc-800 overflow-hidden flex flex-col">
          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-3">Лог Сражения</p>
          <div className="flex-grow overflow-y-auto font-mono text-[10px] text-zinc-500 space-y-1 custom-scrollbar pr-2">
            {log.map((l, i) => <div key={i} className="p-2 bg-zinc-950/50 rounded border-l-2 border-zinc-800">{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
