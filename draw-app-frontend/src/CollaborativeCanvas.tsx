import React, { useRef, useEffect, useState, type MouseEvent } from 'react';
import useWebSocketImport from 'react-use-websocket';

const useWebSocket =
    typeof useWebSocketImport === 'function'
        ? useWebSocketImport
        : (useWebSocketImport as unknown as { default: typeof useWebSocketImport }).default;

interface DrawPayload {
    prevX: number;
    prevY: number;
    currentX: number;
    currentY: number;
    color: string;
    lineWidth: number;
}

export default function CollaborativeCanvas() {
    
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const isDrawingRef = useRef<boolean>(false);
    const lastCoordinatesRef = useRef<{x: number; y: number} | null>(null);

    const [roomID, setRoomId] = useState<string>('lobby');
    const [roomInput, setRoomInput] = useState<string>('');
    const [brushColour, setBrushColour] = useState<string>('#000000');
    const [brushWidth, setBrushWidth] = useState<number>(5);

    const socketURL = `ws://localhost:8000/ws?room=${roomID}`;
    const { sendMessage, lastMessage, readyState } = useWebSocket(socketURL, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
    });

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) return;

        canvas.width = 800;
        canvas.height = 600;

        const context = canvas.getContext('2d');
        if (!context) return;

        context.lineCap = 'round';
        context.lineJoin = 'round';
        contextRef.current = context;
    }, []);

    useEffect(() => {
        if (lastMessage !== null && contextRef.current) {
            try {
                const data: DrawPayload = JSON.parse(lastMessage.data);

                const cntx = contextRef.current;
                cntx.beginPath();
                cntx.strokeStyle = data.color;
                cntx.lineWidth = data.lineWidth;
                cntx.moveTo(data.prevX, data.prevY);
                cntx.lineTo(data.currentX, data.currentY);
                cntx.stroke();
                cntx.closePath();
            } catch (errr) {
                console.error('Error with draw payload: ', errr);
            }
        }
    }, [lastMessage]);

    const getCoordinates = (ev: MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        return {
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
        };
    };

    const startDrawing = (ev: MouseEvent<HTMLCanvasElement>) => {
        const coords = getCoordinates(ev);
        if (!coords) return;

        isDrawingRef.current = true;
        lastCoordinatesRef.current = coords;
    };

    const stopDrawing = () => {
        isDrawingRef.current = false;
        lastCoordinatesRef.current = null;
    };

    const lastEmitTimeRef = useRef<number>(0);

    const draw = (ev: MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current || !contextRef.current || !lastCoordinatesRef.current) return;

        const coords = getCoordinates(ev);
        if (!coords) return;

        const now = performance.now();
        if (now - lastEmitTimeRef.current > 16) {
            const payload: DrawPayload = {
                prevX: lastCoordinatesRef.current.x,
                prevY: lastCoordinatesRef.current.y,
                currentX: coords.x,
                currentY: coords.y,
                color: brushColour,
                lineWidth: brushWidth,
            };

            const cntx = contextRef.current;
            cntx.beginPath();
            cntx.strokeStyle = payload.color;
            cntx.lineWidth = payload.lineWidth;
            cntx.moveTo(payload.prevX, payload.prevY);
            cntx.lineTo(payload.currentX, payload.currentY);
            cntx.stroke();
            cntx.closePath();

            // send to websocket 
            sendMessage(JSON.stringify(payload));

            lastCoordinatesRef.current = coords;
            lastEmitTimeRef.current = now;
        }
    };

    const handleRoomSwitch = (ev: React.FormEvent) => {
        ev.preventDefault();
        if (roomInput.trim()) {
            if (contextRef.current && canvasRef.current) {
                contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }
            setRoomId(roomInput.trim().toLowerCase());
        }
    };

    return (
        <div style = {{padding: '20px', fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto'}}>
            <h2>DRAWALIVE</h2>
            <div style={{display: 'flex', gap: '20px', marginBottom: '15px', alignItems: 'center', background: '#111111', padding: '12px', borderRadius: '6px' }}>
                <form onSubmit={handleRoomSwitch} style={{ display: 'flex', gap: '6px'}}>
                    <input 
                        type="text"
                        placeholder="Room Name... "
                        value={roomInput}
                        onChange={(ev) => setRoomInput(ev.target.value)} 
                    />
                    <button type="submit" style={{padding: '6px 12px', cursor: 'pointer'}}>Join Room</button>
                </form>

                <div style={{fontSize: '14px'}}>
                    Active Rooms: <strong style={{color: '#0070f3'}}>{roomID}</strong>
                </div>

                <div style ={{ marginLeft: 'auto', fontSize: '13px'}}>
                    Status: {readyState === 1 ? <span style={{color: 'green'}}>● Connected</span>: <span style={{color:'red'}}>○ Offline</span>}
                </div>
            </div>

            <div style={{display: 'flex', gap: '15px', marginBottom: '15px', alignItems: 'center'}}>
                <label>
                    Color:{' '}
                    <input type="color" value={brushColour} onChange={(ev) => setBrushColour(ev.target.value)} style={{cursor: 'pointer'}}/>
                </label>

                <label>
                    Size: {brushWidth}px{' '}
                    <input type="range" min="1" max="20" value={brushWidth} onChange={(ev) => setBrushWidth(Number(ev.target.value))}/>
                </label>
            </div>

            <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onMouseMove={draw}
                style={
                    {
                        border: '2px solid #333',
                        borderRadius: '4px',
                        backgroundColor: '#ffffff',
                        cursor: 'crosshair',
                        display: 'block',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }
                }
            />
        </div>
    );
}