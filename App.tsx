
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

  // 1. Ожидание загрузки скрипта PeerJS
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (getPeerClass()) {
        setIsPeerLibReady(true);
        clearInterval(checkInterval);
      }
    }, 100);
    return () => clearInterval(checkInterval);
  }, []);

  // 2. Инициализация основного Peer объекта
  const initPeer = () => {
    const PeerClass = getPeerClass();
    if (!PeerClass) return;

    if (peerRef.current) {
      peerRef.current.destroy();
    }
    
    setPeerError(null);
    const newId = generateShortId();

    // Используем настройки для повышения стабильности соединения
    const peer = new PeerClass(newId, {
      debug: 1,
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      config: {
        'iceServers': [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        'sdpSemantics': 'unified-plan'
      }
    });
    
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      console.log('Peer открыт:', id);
      setMyPeerId(id);
      setPeerError(null);
    });

    peer.on('connection', (conn: any) => {
      console.log('Входящее соединение...');
      if (connection) connection.close();
      setConnection(conn);
      setMyColor(Color.WHITE);
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
      console.error('PeerJS Error:', err.type, err);
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'lost-connection') {
        setPeerError('Связь с сервером потеряна. Переподключение...');
        setTimeout(initPeer, 3000);
      } else if (err.type === 'unavailable-id') {
        initPeer();
      } else if (err.type === 'peer-not-found') {
        setPeerError('Игрок с таким кодом не найден.');
        setIsConnecting(false);
      } else {
        setPeerError(`Ошибка системы: ${err.type}`);
        setIsConnecting(false);
      }
    });

    peer.on('disconnected', () => {
      console.log('Peer отключен от сервера сигналов. Пробуем вернуть связь...');
      peer.reconnect();
    });
  };

  useEffect(() => {
    if (isPeerLibReady) initPeer();
    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      peerRef.current?.destroy();
    };
  }, [isPeerLibReady]);

  // 3. Настройка конкретного соединения (DataConnection)
  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnected(true);
      setIsConnecting(false);
      setPeerError(null);
      setLog(prev => ["Второй игрок подключился!", ...prev]);
      
      // Запуск Heartbeat (пингование), чтобы соединение не "засыпало"
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (conn.open) {
          conn.send({ type: 'PING' });
        }
      }, 5000);

      if (myColor === Color.WHITE) {
        conn.send({ type: 'STATE_UPDATE', state: { ...state, cells: Array.from(state.cells) } });
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'PING') return; // Игнорируем пинг

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
      setLog(prev => ["Связь с игроком потеряна.", ...prev]);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    });

    conn.on('error', (err: any) => {
      console.error('Connection Data Error:', err);
      setIsConnected(false);
      setIsConnecting(false);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current || isConnecting) return;
    
    setIsConnecting(true);
    setPeerError(null);
    
    const conn = peerRef.current.connect(remotePeerId.trim().toUpperCase(), {
      reliable: true
    });
    
    setConnection(conn);
    setMyColor(Color.BLACK);
    setupConnection(conn);
    
    // Таймаут на подключение
    setTimeout(() => {
      if (!conn.open && isConnecting) {
        setIsConnecting(false);
        setPeerError('Превышено время ожидания подключения.');
      }
    }, 10000);
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

        // Логика победы
        if (targetPiece?.type === PieceType.KING) {
          const msg = `Король ${targetPiece.color === Color.WHITE ? 'Белых' : 'Черных'} пал!`;
          setGameOver(msg);
          if (connection?.open) connection.send({ type: 'GAME_OVER', message: msg });
        }

        // Шанс расширения поля
        if (Math.random() < 0.15) {
          const { newCells } = ChessEngine.expandBoard(state.cells);
          newState.cells = newCells;
        }

        setState(newState);
        if (connection?.open) {
          connection.send({ 
            type: 'STATE_UPDATE', 
            state: { ...newState, cells: Array.from(newState.cells) },
            log: `${activePiece.type} на ${pos.x},${pos.y}`
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

  // Экран загрузки библиотеки
  if (!isPeerLibReady) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-zinc-500 font-mono">
        <div className="w-10 h-10 border-2 border-zinc-800 border-t-blue-500 rounded-full animate-spin mb-4"></div>
        <p className="text-sm tracking-widest animate-pulse">CONNECTING TO NETWORK...</p>
      </div>
    );
  }

  // Экран входа / Главное меню
  if (!myColor) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6 overflow-hidden">
        <div className="max-w-md w-full bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
          
          <h1 className="text-5xl font-black text-white mb-2 italic tracking-tighter">CHAOTIC CHESS</h1>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.4em] mb-10 pl-1">Quantum Matchmaking v2</p>
          
          <div className="space-y-8">
            <div className="bg-zinc-950/80 p-5 rounded-3xl border border-zinc-800/50">
              <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Твой секретный код:</span>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-mono text-blue-400 font-bold tracking-widest">{myPeerId || '...'}</p>
                <div className={`w-2 h-2 rounded-full ${myPeerId ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-zinc-800 animate-pulse'}`}></div>
              </div>
            </div>

            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="ВВЕДИ КОД ДРУГА" 
                value={remotePeerId}
                disabled={isConnecting}
                onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
                className="w-full bg-zinc-800/50 border border-zinc-700/50 p-5 rounded-3xl text-white font-mono text-center outline-none focus:ring-2 ring-blue-500/50 transition-all text-xl"
              />
              <button 
                onClick={connectToPeer}
                disabled={!myPeerId || isConnecting || !remotePeerId}
                className="w-full bg-white text-black font-black py-5 rounded-3xl hover:bg-blue-500 hover:text-white transition-all transform active:scale-95 disabled:opacity-30 disabled:grayscale text-lg shadow-xl shadow-black/20"
              >
                {isConnecting ? 'ПОДКЛЮЧЕНИЕ...' : 'В БОЙ'}
              </button>
            </div>

            {peerError && (
              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl">
                <p className="text-red-400 text-[11px] uppercase font-black text-center leading-relaxed italic">{peerError}</p>
              </div>
            )}
          </div>
          
          <div className="mt-10 pt-6 border-t border-zinc-800/50 text-center">
            <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold">Ожидайте загрузки кода перед началом</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-zinc-950 text-white p-4 gap-4 overflow-hidden">
      {/* Игровое поле */}
      <div className="flex-grow bg-zinc-900 rounded-[2rem] border border-zinc-800 relative flex items-center justify-center overflow-auto custom-scrollbar shadow-inner">
        <div 
          className="grid gap-px bg-zinc-800 p-px shadow-2xl transition-all duration-700"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, 52px)`,
            gridTemplateRows: `repeat(${boardBounds.height}, 52px)`,
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

              if (!exists) return <div key={key} className="w-[52px] h-[52px] bg-zinc-950/10" />;

              return (
                <div 
                  key={key}
                  onClick={() => handleCellClick({x,y})}
                  className={`w-[52px] h-[52px] flex items-center justify-center text-3xl cursor-pointer transition-all duration-200
                    ${(x+y)%2 === 0 ? 'bg-zinc-200 hover:bg-white' : 'bg-zinc-700 hover:bg-zinc-600'}
                    ${isSelected ? 'ring-4 ring-yellow-400 z-10 scale-105' : ''}
                    ${isValid ? 'relative after:absolute after:w-3 after:h-3 after:bg-green-500/60 after:rounded-full after:animate-pulse' : ''}
                  `}
                >
                  {piece && (
                    <span className={`
                      ${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} 
                      drop-shadow-lg select-none transform transition-transform hover:scale-110 active:scale-90
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
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-50 p-6 text-center">
            <h2 className="text-6xl font-black text-yellow-500 mb-6 italic animate-bounce tracking-tighter">VICTORY</h2>
            <p className="text-white mb-10 font-bold text-2xl uppercase tracking-widest">{gameOver}</p>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-12 py-5 rounded-full font-black hover:bg-yellow-400 transition-all text-xl shadow-2xl">REMATCH</button>
          </div>
        )}
      </div>

      {/* Панель управления */}
      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-6 rounded-[2rem] border border-zinc-800 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">P2P Network</span>
            <div className="flex items-center gap-2">
               <span className="text-[9px] text-zinc-600 font-bold">{isConnected ? 'STABLE' : 'LOST'}</span>
               <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-black italic tracking-tighter">{myColor === Color.WHITE ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}</p>
            <p className={`text-[11px] uppercase font-bold tracking-widest ${state.turn === myColor ? 'text-blue-500' : 'text-zinc-600'}`}>
              {state.turn === myColor ? '● Твой ход' : '○ Ожидание игрока...'}
            </p>
          </div>
        </div>

        <div className="flex-grow bg-zinc-900 p-6 rounded-[2rem] border border-zinc-800 overflow-hidden flex flex-col shadow-xl">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-5">Battle Logs</p>
          <div className="flex-grow overflow-y-auto space-y-3 pr-2 custom-scrollbar">
            {log.length === 0 && <p className="text-zinc-700 italic text-[10px]">История пуста...</p>}
            {log.map((entry, i) => (
              <div key={i} className="p-3 bg-zinc-950/50 rounded-2xl border-l-4 border-zinc-800 text-[10px] font-mono text-zinc-400 animate-fadeIn">
                <span className="text-zinc-600 mr-2">[{log.length - i}]</span> {entry}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
