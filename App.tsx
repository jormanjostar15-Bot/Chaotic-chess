
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

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    setPeerError(null);
    const peer = new PeerClass(generateShortId(), {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
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
      console.error('PeerJS Error:', err.type);
      if (['network', 'server-error', 'lost-connection', 'socket-error'].includes(err.type)) {
        setPeerError('Связь прервана. Переподключение...');
        if (!restartTimerRef.current) {
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            initPeer();
          }, 4000);
        }
      } else if (err.type === 'peer-not-found') {
        setPeerError('Код не найден.');
        setIsConnecting(false);
      } else {
        setPeerError(`Ошибка: ${err.type}`);
        setIsConnecting(false);
      }
    });

    peer.on('disconnected', () => {
      peer.reconnect();
    });
  };

  useEffect(() => {
    if (isPeerLibReady) initPeer();
    return () => {
      peerRef.current?.destroy();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [isPeerLibReady]);

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnected(true);
      setIsConnecting(false);
      setPeerError(null);
      setLog(prev => ["Соединение установлено!", ...prev]);
      
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (conn.open) conn.send({ type: 'HB' });
      }, 3000);

      if (myColor === Color.WHITE) {
        conn.send({ type: 'SYNC', state: { ...state, cells: Array.from(state.cells) } });
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'HB') return;
      if (data.type === 'SYNC') {
        const newState = { ...data.state, cells: new Set(data.state.cells) };
        setState(newState);
        if (data.log) setLog(prev => [data.log, ...prev.slice(0, 15)]);
      }
      if (data.type === 'OVER') setGameOver(data.msg);
    });

    conn.on('close', () => {
      setIsConnected(false);
      setLog(prev => ["Партнер отключился.", ...prev]);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    });
  };

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current || isConnecting) return;
    setIsConnecting(true);
    setPeerError(null);
    const conn = peerRef.current.connect(remotePeerId.trim().toUpperCase(), { reliable: true });
    setConnection(conn);
    setMyColor(Color.BLACK);
    setupConnection(conn);
    setTimeout(() => { if (!conn.open && isConnecting) setIsConnecting(false); }, 10000);
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
          const msg = `КОРОЛЬ ${target.color === Color.WHITE ? 'БЕЛЫХ' : 'ЧЕРНЫХ'} ПАЛ!`;
          setGameOver(msg);
          connection?.send({ type: 'OVER', msg });
        }
        if (Math.random() < 0.15) {
          newState.cells = ChessEngine.expandBoard(state.cells).newCells;
        }
        setState(newState);
        connection?.send({ type: 'SYNC', state: { ...newState, cells: Array.from(newState.cells) }, log: `${active.type.toUpperCase()} на ${pos.x},${pos.y}` });
        setSelected(null); setValidMoves([]);
        return;
      }
    }
    if (piece?.color === myColor) {
      setSelected(pos);
      setValidMoves(ChessEngine.getValidMoves(state, pos));
    } else {
      setSelected(null); setValidMoves([]);
    }
  };

  if (!isPeerLibReady) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-zinc-600 font-mono">
        <div className="w-8 h-8 border-t-2 border-blue-500 rounded-full animate-spin mb-4"></div>
        <p className="text-[10px] tracking-widest uppercase">Initializing Core...</p>
      </div>
    );
  }

  if (!myColor) {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-10 rounded-[2.5rem] shadow-2xl">
          <h1 className="text-5xl font-black text-white mb-2 italic tracking-tighter text-center">CHAOTIC</h1>
          <h2 className="text-2xl font-black text-blue-600 mb-10 italic tracking-tighter text-center -mt-4">CHESS</h2>
          <div className="space-y-6">
            <div className="bg-zinc-950 p-5 rounded-3xl border border-zinc-800">
              <span className="text-[9px] text-zinc-600 font-black uppercase tracking-widest block mb-1">Твой боевой ID:</span>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-mono text-white font-bold tracking-widest">{myPeerId || '...'}</p>
                <div className={`w-2.5 h-2.5 rounded-full ${myPeerId ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-zinc-800 animate-pulse'}`}></div>
              </div>
            </div>
            <div className="space-y-3">
              <input 
                type="text" placeholder="КОД ОППОНЕНТА" value={remotePeerId}
                disabled={isConnecting}
                onChange={e => setRemotePeerId(e.target.value.toUpperCase())}
                className="w-full bg-zinc-800 border border-zinc-700 p-5 rounded-2xl text-white font-mono text-center outline-none focus:ring-2 ring-blue-500/50 text-xl tracking-widest"
              />
              <button 
                onClick={connectToPeer}
                disabled={!myPeerId || isConnecting || !remotePeerId}
                className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl hover:bg-blue-500 transition-all active:scale-95 disabled:opacity-20 uppercase tracking-widest"
              >
                {isConnecting ? 'Синхронизация...' : 'Вступить в бой'}
              </button>
            </div>
            {peerError && <p className="text-red-500 text-[9px] uppercase font-black text-center tracking-wider">{peerError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-zinc-950 text-white p-4 gap-4 overflow-hidden">
      <div className="flex-grow bg-zinc-900 rounded-[2rem] border border-zinc-800 relative flex items-center justify-center overflow-auto custom-scrollbar">
        <div 
          className="grid gap-px bg-zinc-800 p-px shadow-2xl transition-all duration-700"
          style={{
            gridTemplateColumns: `repeat(${boardBounds.width}, 54px)`,
            gridTemplateRows: `repeat(${boardBounds.height}, 54px)`,
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
              if (!exists) return <div key={key} className="w-[54px] h-[54px]" />;
              return (
                <div 
                  key={key} onClick={() => handleCellClick({x,y})}
                  className={`w-[54px] h-[54px] flex items-center justify-center text-4xl cursor-pointer transition-all duration-300
                    ${(x+y)%2 === 0 ? 'bg-zinc-200 hover:bg-white' : 'bg-zinc-700 hover:bg-zinc-600'}
                    ${isSelected ? 'ring-4 ring-blue-500 z-10 scale-110 shadow-2xl' : ''}
                    ${isValid ? 'relative after:absolute after:w-4 after:h-4 after:bg-green-500/40 after:rounded-full after:animate-pulse' : ''}
                  `}
                >
                  {piece && <span className={`${piece.color === Color.WHITE ? 'text-white' : 'text-zinc-900'} drop-shadow-2xl transform transition-all hover:scale-125`}>{PIECE_ICONS[piece.type][piece.color]}</span>}
                </div>
              );
            })}
          )}
        </div>
        {gameOver && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-10 text-center">
            <h2 className="text-7xl font-black text-blue-500 mb-4 italic tracking-tighter">FINISH</h2>
            <p className="text-white mb-12 font-bold text-2xl uppercase tracking-[0.2em]">{gameOver}</p>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-16 py-6 rounded-full font-black hover:bg-blue-600 hover:text-white transition-all text-xl tracking-widest">NEXT GAME</button>
          </div>
        )}
      </div>
      <div className="w-full md:w-80 flex flex-col gap-4">
        <div className="bg-zinc-900 p-8 rounded-[2rem] border border-zinc-800 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Network Node</span>
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_12px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
          </div>
          <p className="text-4xl font-black italic tracking-tighter text-blue-500">{myColor === Color.WHITE ? 'БЕЛЫЕ' : 'ЧЕРНЫЕ'}</p>
          <p className={`text-[12px] uppercase font-black tracking-widest ${state.turn === myColor ? 'text-white' : 'text-zinc-700'}`}>
            {state.turn === myColor ? '⚡ Твой ход' : '⌛ Ждем врага'}
          </p>
        </div>
        <div className="flex-grow bg-zinc-900 p-8 rounded-[2rem] border border-zinc-800 overflow-hidden flex flex-col">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-6 pl-1">Tactical Log</p>
          <div className="flex-grow overflow-y-auto space-y-4 pr-3 custom-scrollbar font-mono text-zinc-400 text-[11px]">
            {log.map((entry, i) => <div key={i} className="p-4 bg-zinc-950 rounded-2xl border-l-4 border-blue-900">{entry}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
