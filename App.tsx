
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Color, PieceType, Position, Piece, BoardState, Move, PIECE_COSTS } from './types';
import { ChessEngine, posToKey, keyToPos } from './logic/chessLogic';

// Безопасное получение Peer из глобальной области
const getPeerClass = () => (window as any).Peer;

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
  const [log, setLog] = useState<string[]>(["Система инициализирована."]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  
  const [isPeerLibReady, setIsPeerLibReady] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerId, setRemotePeerId] = useState<string>('');
  const [connection, setConnection] = useState<any>(null);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const peerRef = useRef<any>(null);
  const heartbeatIntervalRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // Ожидание загрузки скрипта PeerJS
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (getPeerClass()) {
        setIsPeerLibReady(true);
        clearInterval(checkInterval);
      }
    }, 100);
    return () => clearInterval(checkInterval);
  }, []);

  // Инициализация основного Peer объекта с улучшенной обработкой ошибок сети
  const initPeer = () => {
    const PeerClass = getPeerClass();
    if (!PeerClass) return;

    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    setPeerError(null);
    const newId = generateShortId();

    const peer = new PeerClass(newId, {
      debug: 1,
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      config: {
        'iceServers': [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });
    
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      console.log('Peer успешно открыт:', id);
      setMyPeerId(id);
      setPeerError(null);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    });

    peer.on('connection', (conn: any) => {
      if (connection) connection.close();
      setConnection(conn);
      setMyColor(Color.WHITE);
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
      console.error('PeerJS Global Error:', err.type);
      
      // Обработка фатальных сетевых ошибок
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'lost-connection' || err.type === 'socket-error') {
        setPeerError('Ошибка сети. Пытаемся восстановить сессию...');
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            initPeer();
          }, 5000);
        }
      } else if (err.type === 'unavailable-id') {
        initPeer();
      } else if (err.type === 'peer-not-found') {
        setPeerError('Код не найден. Проверь правильность ввода.');
        setIsConnecting(false);
      } else {
        setPeerError(`Сбой: ${err.type}`);
        setIsConnecting(false);
      }
    });

    peer.on('disconnected', () => {
      console.warn('Отключено от сервера сигналов. Попытка переподключения...');
      peer.reconnect();
    });
  };

  useEffect(() => {
    if (isPeerLibReady) initPeer();
    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      peerRef.current?.destroy();
    };
  }, [isPeerLibReady]);

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnected(true);
      setIsConnecting(false);
      setPeerError(null);
      setLog(prev => ["БОЙ НАЧАЛСЯ!", ...prev]);
      
      // Heartbeat (keep-alive)
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (conn.open) {
          conn.send({ type: 'HEARTBEAT' });
        } else {
          clearInterval(heartbeatIntervalRef.current);
        }
      }, 4000);

      if (myColor === Color.WHITE) {
        conn.send({ type: 'STATE_UPDATE', state: { ...state, cells: Array.from(state.cells) } });
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
      setConnection(null);
      setLog(prev => ["Противник дезертировал.", ...prev]);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    });

    conn.on('error', (err: any) => {
      console.error('Data Connection Error:', err);
      setIsConnected(false);
      setIsConnecting(false);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current || isConnecting) return;
    
    setIsConnecting(true);
    setPeerError(null);
    
    // Пытаемся подключиться с повышенным приоритетом
    const conn = peerRef.current.connect(remotePeerId.trim().toUpperCase(), {
      reliable: true,
      connectionPriority: 'high'
    });
    
    setConnection(conn);
    setMyColor(Color.BLACK);
    setupConnection(conn);
    
    setTimeout(() => {
      if (!conn.open && isConnecting) {
        setIsConnecting(false);
        setPeerError('Не удалось достучаться до оппонента.');
      }
    }, 12000);
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

  const handleCellClick = (pos: Position) => {
    if (gameOver || state.turn !== myColor || !isConnected) return;
    
    const piece = state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
    if (selected) {
      if (validMoves.some(m => m.x === pos.x && m.y === pos.y)) {
        const activePiece = state.pieces.find(p => p.pos.x === selected.x && p.pos.y === selected.y)!;
        const targetPiece = state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
        
        let nextPieces = state.pieces
          .filter(p => !(p.pos.x === pos.x && p.pos.y === pos.y))
          .map(p => (p.pos.x === selected.x && p.pos.y === selected.y) ? { ...p, pos, hasMoved: true } : p);
        
        const nextTurn = state.turn === Color.WHITE ? Color.BLACK : Color.WHITE;
        let newState = { ...state, pieces: nextPieces, turn: nextTurn };

        if (targetPiece?.type === PieceType.KING) {
          const msg = `КОРОЛЬ ${targetPiece.color === Color.WHITE ? 'БЕЛЫХ' : 'ЧЕРНЫХ'} ПАЛ!`;
          setGameOver(msg);
          if (connection?.open) connection.send({ type: 'GAME_OVER', message: msg });
        }

        if (Math.random() < 0.20) {
          const { newCells } = ChessEngine.expandBoard(state.cells);
          newState.cells = newCells;
        }

        setState(newState);
        if (connection?.open) {
          connection.send({ 
            type: 'STATE_UPDATE', 
            state: { ...newState, cells: Array.from(newState.cells) },
            log: `${activePiece.type.toUpperCase()} -> ${pos.x},${pos.y}`
          });
        }
        setSelected(null);
        setValidMoves([]);
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

  if (!isPeerLibReady) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-zinc-500 font-mono">
        <div className="w-12 h-12 border-b-2 border-blue-500 rounded-full animate-spin mb-6"></div>
        <p className="text-xs tracking-[0.5em] animate-pulse uppercase">Syncing Neural Link...</p>
      </div>
    );
  }

  if (!myColor) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-zinc-900/40 backdrop-blur-3xl border border-zinc-800 p-10 rounded-[3rem] shadow-2xl relative">
          <div className="absolute -top-20 -left-20 w-40 h-40 bg-blue-500/10 rounded-full blur-[100px]"></div>
          
          <h1 className="text-6xl font-black text-white mb-2 italic tracking-tighter text-center">CHAOTIC</h1>
          <h2 className="text-3xl font-black text-blue-500 mb-10 italic tracking-tighter text-center -mt-4">CHESS</h2>
          
          <div className="space-y-8">
            <div className="bg-zinc-950/60 p-6 rounded-[2rem] border border-zinc-800/80 group transition-all hover:border-blue-500/30">
              <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest block mb-3 pl-1">Твой боевой шифр:</span>
              <div className="flex items-center justify-between">
                <p className="text-4xl font-mono text-white font-bold tracking-widest">{myPeerId || '...'}</p>
                <div className={`w-3 h-3 rounded-full ${myPeerId ? 'bg-green-500 shadow-[0_0_15px_#22c55e]' : 'bg-zinc-800 animate-pulse'}`}></div>
              </div>
            </div>

            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="ВВЕДИ ШИФР ВРАГА" 
                value={remotePeerId}
                disabled={isConnecting}
                onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
                className="w-full bg-zinc-800/40 border border-zinc-700/40 p-6 rounded-[2rem] text-white font-mono text-center outline-none focus:ring-2 ring-blue-500/40 transition-all text-2xl uppercase tracking-widest placeholder:text-zinc-700"
              />
              <button 
                onClick={connectToPeer}
                disabled={!myPeerId || isConnecting || !remotePeerId}
                className="w-full bg-blue-600 text-white font-black py-6 rounded-[2rem] hover:bg-blue-500 transition-all transform active:scale-95 disabled:opacity-20 disabled:grayscale text-xl shadow-lg shadow-blue-900/20 uppercase tracking-widest"
              >
                {isConnecting ? 'Ищем цель...' : 'В атаку'}
              </button>
            </div>

            {peerError && (
              <div className="bg-red-500/5 border border-red-500/20 p-5 rounded-[1.5rem] animate-shake">
                <p className="text-red-400 text-[10px] uppercase font-black text-center leading-relaxed tracking-wider">{peerError}</p>
              </div>
            )}
          </div>
          
          <p className="mt-12 text-[9px] text-zinc-700 text-center font-bold uppercase tracking-[0.3em]">Quantum Matchmaking Signal: Stable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-zinc-950 text-white p-4 gap-4 overflow-hidden font-sans">
      <div className="flex-grow bg-zinc-900/50 rounded-[2.5rem] border border-zinc-800 relative flex items-center justify-center overflow-auto custom-scrollbar">
        <div 
          className="grid gap-px bg-zinc-800/50 p-px shadow-2xl transition-all duration-700"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, 56px)`,
            gridTemplateRows: `repeat(${boardBounds.height}, 56px)`,
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

              if (!exists) return <div key={key} className="w-[56px] h-[56px] bg-transparent" />;

              return (
                <div 
                  key={key}
                  onClick={() => handleCellClick({x,y})}
                  className={`w-[56px] h-[56px] flex items-center justify-center text-4xl cursor-pointer transition-all duration-300
                    ${(x+y)%2 === 0 ? 'bg-zinc-200 hover:bg-white' : 'bg-zinc-700 hover:bg-zinc-600'}
                    ${isSelected ? 'ring-4 ring-blue-500 z-10 scale-110 shadow-2xl' : ''}
                    ${isValid ? 'relative after:absolute after:w-4 after:h-4 after:bg-green-500/40 after:rounded-full after:animate-ping' : ''}
                  `}
                >
                  {piece && (
                    <span className={`
                      ${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} 
                      drop-shadow-2xl select-none transform transition-all hover:scale-125 active:rotate-12
                    `}>
                      {PIECE_ICONS[piece.type][piece.color]}
                    </span>
                  )}
                </div>
              );
            })}
          )}
        </div>

        {gameOver && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-10 text-center">
            <h2 className="text-8xl font-black text-blue-500 mb-4 italic animate-pulse tracking-tighter">FINISH</h2>
            <p className="text-white mb-12 font-bold text-3xl uppercase tracking-[0.2em] max-w-lg">{gameOver}</p>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-16 py-6 rounded-full font-black hover:bg-blue-500 hover:text-white transition-all text-2xl shadow-2xl tracking-widest">NEXT ROUND</button>
          </div>
        )}
      </div>

      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900/80 p-8 rounded-[2.5rem] border border-zinc-800 shadow-xl">
          <div className="flex justify-between items-center mb-8">
            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Network Node</span>
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_12px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-4xl font-black italic tracking-tighter text-blue-500">{myColor === Color.WHITE ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}</p>
            <p className={`text-[12px] uppercase font-black tracking-widest ${state.turn === myColor ? 'text-white' : 'text-zinc-700'}`}>
              {state.turn === myColor ? '⚡ Твой ход' : '⌛ Ждем врага'}
            </p>
          </div>
        </div>

        <div className="flex-grow bg-zinc-900/80 p-8 rounded-[2.5rem] border border-zinc-800 overflow-hidden flex flex-col shadow-xl">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-6 pl-1">Tactical Log</p>
          <div className="flex-grow overflow-y-auto space-y-4 pr-3 custom-scrollbar">
            {log.map((entry, i) => (
              <div key={i} className="p-4 bg-zinc-950/40 rounded-3xl border-l-4 border-blue-900 text-[11px] font-mono text-zinc-400 animate-fadeIn flex gap-3">
                <span className="text-zinc-700 font-black">{(log.length - i).toString().padStart(2, '0')}</span>
                <span>{entry}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
