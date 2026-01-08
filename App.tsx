
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Color, PieceType, Position, Piece, BoardState, Move, PIECE_COSTS } from './types';
import { ChessEngine, posToKey, keyToPos } from './logic/chessLogic';

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
  const [log, setLog] = useState<string[]>(["Система активна."]);
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
  const heartbeatRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);

  // Ожидание готовности библиотеки PeerJS
  useEffect(() => {
    const timer = setInterval(() => {
      if (getPeerClass()) {
        setIsPeerLibReady(true);
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const initPeer = () => {
    const PeerClass = getPeerClass();
    if (!PeerClass) return;

    // Очистка предыдущего экземпляра
    if (peerRef.current) {
      peerRef.current.removeAllListeners();
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    setPeerError(null);
    const peer = new PeerClass(generateShortId(), {
      // Использование стандартных настроек для минимизации ошибок 'network'
      debug: 1,
      secure: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        sdpSemantics: 'unified-plan'
      }
    });
    
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      setMyPeerId(id);
      setPeerError(null);
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
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
      
      // Агрессивное восстановление при сетевых ошибках
      if (['network', 'server-error', 'lost-connection', 'socket-error'].includes(err.type)) {
        setPeerError('Связь с сервером потеряна. Восстановление...');
        if (!restartTimerRef.current) {
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            initPeer();
          }, 3000); // Быстрый перезапуск при потере связи
        }
      } else if (err.type === 'peer-not-found') {
        setPeerError('ID не найден. Проверьте код.');
        setIsConnecting(false);
      } else if (err.type === 'unavailable-id') {
        initPeer();
      } else {
        setPeerError(`Ошибка системы: ${err.type}`);
        setIsConnecting(false);
      }
    });

    peer.on('disconnected', () => {
      // Если Peer отключился от сервера сигналов, пытаемся переподключиться без смены ID
      console.warn('Disconnected from signaling server. Reconnecting...');
      peer.reconnect();
    });
  };

  useEffect(() => {
    if (isPeerLibReady) initPeer();
    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, [isPeerLibReady]);

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnected(true);
      setIsConnecting(false);
      setPeerError(null);
      setLog(prev => ["Соединение установлено. Бой начинается!", ...prev]);
      
      // Heartbeat (keep-alive) для предотвращения разрыва P2P канала
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (conn.open) {
          conn.send({ type: 'PING' });
        } else {
          clearInterval(heartbeatRef.current);
        }
      }, 4000);

      if (myColor === Color.WHITE) {
        conn.send({ type: 'SYNC', state: { ...state, cells: Array.from(state.cells) } });
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'PING') return;
      if (data.type === 'SYNC') {
        const newState = { ...data.state, cells: new Set(data.state.cells) };
        setState(newState);
        if (data.log) setLog(prev => [data.log, ...prev.slice(0, 15)]);
      }
      if (data.type === 'OVER') setGameOver(data.msg);
    });

    conn.on('close', () => {
      setIsConnected(false);
      setLog(prev => ["Связь с оппонентом разорвана.", ...prev]);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    });

    conn.on('error', (err: any) => {
      console.error('Connection Error:', err);
      setIsConnected(false);
      setIsConnecting(false);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current || isConnecting) return;
    setIsConnecting(true);
    setPeerError(null);
    
    // Попытка подключения с надежными настройками
    const conn = peerRef.current.connect(remotePeerId.trim().toUpperCase(), { 
      reliable: true,
      metadata: { timestamp: Date.now() }
    });
    
    setConnection(conn);
    setMyColor(Color.BLACK);
    setupConnection(conn);
    
    // Таймаут на случай "тихого" провала подключения
    setTimeout(() => { 
      if (!conn.open && isConnecting) {
        setIsConnecting(false);
        setPeerError('Тайм-аут подключения. Попробуйте еще раз.');
      }
    }, 15000);
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
        const active = state.pieces.find(p => p.pos.x === selected.x && p.pos.y === selected.y)!;
        const target = state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y);
        
        let nextPieces = state.pieces
          .filter(p => !(p.pos.x === pos.x && p.pos.y === pos.y))
          .map(p => (p.pos.x === selected.x && p.pos.y === selected.y) ? { ...p, pos, hasMoved: true } : p);
        
        let newState = { ...state, pieces: nextPieces, turn: state.turn === Color.WHITE ? Color.BLACK : Color.WHITE };
        
        if (target?.type === PieceType.KING) {
          const msg = `КОРОЛЬ ${target.color === Color.WHITE ? 'БЕЛЫХ' : 'ЧЕРНЫХ'} ПОВЕРЖЕН!`;
          setGameOver(msg);
          connection?.send({ type: 'OVER', msg });
        }
        
        // Хаотичное расширение
        if (Math.random() < 0.18) {
          newState.cells = ChessEngine.expandBoard(state.cells).newCells;
        }
        
        setState(newState);
        connection?.send({ 
          type: 'SYNC', 
          state: { ...newState, cells: Array.from(newState.cells) }, 
          log: `${active.type.toUpperCase()} -> ${pos.x},${pos.y}` 
        });
        
        setSelected(null); 
        setValidMoves([]);
        return;
      }
    }
    
    if (piece?.color === myColor) {
      setSelected(pos);
      setValidMoves(ChessEngine.getValidMoves(state, pos));
    } else {
      setSelected(null); 
      setValidMoves([]);
    }
  };

  if (!isPeerLibReady) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-zinc-600 font-mono">
        <div className="w-10 h-10 border-t-2 border-blue-600 rounded-full animate-spin mb-4"></div>
        <p className="text-[10px] tracking-widest uppercase animate-pulse">Establishing Signal...</p>
      </div>
    );
  }

  if (!myColor) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(37,99,235,0.1),transparent_70%)] pointer-events-none"></div>
        <div className="max-w-md w-full bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 p-10 rounded-[3rem] shadow-2xl z-10">
          <h1 className="text-6xl font-black text-white mb-2 italic tracking-tighter text-center">CHAOTIC</h1>
          <h2 className="text-3xl font-black text-blue-600 mb-12 italic tracking-tighter text-center -mt-4 uppercase">Chess Online</h2>
          
          <div className="space-y-6">
            <div className="bg-zinc-950 p-6 rounded-[2rem] border border-zinc-800 relative group overflow-hidden">
              <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Ваш квантовый ключ:</span>
              <div className="flex items-center justify-between">
                <p className="text-4xl font-mono text-white font-bold tracking-[0.2em]">{myPeerId || 'Генерация...'}</p>
                <div className={`w-3 h-3 rounded-full ${myPeerId ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)]' : 'bg-zinc-800 animate-pulse'}`}></div>
              </div>
            </div>

            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="ВВЕДИТЕ КОД ВРАГА" 
                value={remotePeerId}
                disabled={isConnecting}
                onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
                className="w-full bg-zinc-800/50 border border-zinc-700 p-6 rounded-[2rem] text-white font-mono text-center outline-none focus:ring-4 ring-blue-500/20 text-2xl tracking-widest placeholder:text-zinc-700 transition-all"
              />
              <button 
                onClick={connectToPeer}
                disabled={!myPeerId || isConnecting || !remotePeerId}
                className="w-full bg-blue-600 text-white font-black py-6 rounded-[2rem] hover:bg-blue-500 transition-all active:scale-95 disabled:opacity-20 uppercase tracking-widest text-xl shadow-xl shadow-blue-900/20"
              >
                {isConnecting ? 'Синхронизация...' : 'Вступить в бой'}
              </button>
            </div>
            
            {peerError && (
              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl animate-shake">
                <p className="text-red-500 text-[10px] uppercase font-black text-center tracking-wider">{peerError}</p>
              </div>
            )}
          </div>
          
          <p className="mt-12 text-[9px] text-zinc-600 text-center font-bold uppercase tracking-[0.4em] opacity-50 italic">Status: Stable Network Nodes</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-zinc-950 text-white p-4 gap-4 overflow-hidden select-none">
      {/* Игровое пространство */}
      <div className="flex-grow bg-zinc-900 rounded-[2.5rem] border border-zinc-800 relative flex items-center justify-center overflow-auto custom-scrollbar shadow-inner">
        <div 
          className="grid gap-px bg-zinc-800/30 p-px shadow-2xl transition-all duration-700"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, 58px)`,
            gridTemplateRows: `repeat(${boardBounds.height}, 58px)`,
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
              
              if (!exists) return <div key={key} className="w-[58px] h-[58px]" />;
              
              return (
                <div 
                  key={key} 
                  onClick={() => handleCellClick({x,y})}
                  className={`w-[58px] h-[58px] flex items-center justify-center text-4xl cursor-pointer transition-all duration-300
                    ${(x+y)%2 === 0 ? 'bg-zinc-100 hover:bg-white' : 'bg-zinc-700 hover:bg-zinc-600'}
                    ${isSelected ? 'ring-4 ring-blue-500 z-10 scale-110 shadow-[0_0_25px_rgba(59,130,246,0.4)]' : ''}
                    ${isValid ? 'relative after:absolute after:w-4 after:h-4 after:bg-green-500/50 after:rounded-full after:animate-pulse shadow-inner' : ''}
                  `}
                >
                  {piece && (
                    <span className={`
                      ${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} 
                      drop-shadow-2xl transform transition-all hover:scale-125 hover:rotate-6 active:scale-90
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
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-10 text-center animate-fadeIn">
            <h2 className="text-8xl font-black text-blue-600 mb-4 italic tracking-tighter uppercase">Конец игры</h2>
            <p className="text-white mb-12 font-bold text-3xl uppercase tracking-widest max-w-2xl">{gameOver}</p>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-16 py-6 rounded-full font-black hover:bg-blue-600 hover:text-white transition-all text-2xl tracking-widest shadow-2xl">НОВЫЙ БОЙ</button>
          </div>
        )}
      </div>

      {/* Боковая панель */}
      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-8 rounded-[2.5rem] border border-zinc-800 shadow-xl relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl"></div>
          <div className="flex justify-between items-center mb-8">
            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Network Grid</span>
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-bold text-zinc-500 uppercase">{isConnected ? 'Online' : 'Lost'}</span>
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)]' : 'bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.8)]'}`}></div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-5xl font-black italic tracking-tighter text-blue-600">{myColor === Color.WHITE ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}</p>
            <p className={`text-[12px] uppercase font-black tracking-[0.2em] transition-colors ${state.turn === myColor ? 'text-white animate-pulse' : 'text-zinc-700'}`}>
              {state.turn === myColor ? '⚡ ВАШ ХОД' : '⌛ ХОД ВРАГА'}
            </p>
          </div>
        </div>

        <div className="flex-grow bg-zinc-900 p-8 rounded-[2.5rem] border border-zinc-800 overflow-hidden flex flex-col shadow-xl">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-6 pl-1 italic">Tactical History</p>
          <div className="flex-grow overflow-y-auto space-y-4 pr-3 custom-scrollbar font-mono text-zinc-400 text-[11px]">
            {log.length === 0 && <p className="text-zinc-800 italic">Ждем первого хода...</p>}
            {log.map((entry, i) => (
              <div key={i} className="p-5 bg-zinc-950/60 rounded-[1.5rem] border-l-4 border-blue-900 hover:border-blue-500 transition-colors group">
                <span className="text-blue-900 font-black group-hover:text-blue-500 transition-colors mr-2">[{log.length - i}]</span>
                <span className="opacity-80">{entry}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
