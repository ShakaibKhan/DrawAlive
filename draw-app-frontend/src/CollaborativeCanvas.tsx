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

interface RoomInfo {
    name: string;
    users: number;
    maxCapacity: number;
    expiresIn: string
}

export default function CollaborativeCanvas() {
    
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const isDrawingRef = useRef<boolean>(false);
    const lastCoordinatesRef = useRef<{x: number; y: number} | null>(null);
    const lastEmitTimeRef = useRef<number>(0);

    const [currentRoom, setCurrentRoom] = useState<string>('lobby');
    const [availableRooms, setAvailableRooms] = useState<RoomInfo[]>([]);

    const [newRoomName, setNewRoomName] = useState<string>('');
    const [newRoomCapacity, setNewRoomCapacity] = useState<number>(10);
    const [brushColour, setBrushColour] = useState<string>('#000000');
    const [brushWidth, setBrushWidth] = useState<number>(5);

    const socketURL = import.meta.env.VITE_WEBSOCKET_SERVER;
    console.log(socketURL);

    const { sendMessage, lastMessage, readyState } = useWebSocket(socketURL, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onOpen: () => {
            sendMessage(JSON.stringify({type: 'get_rooms'}));
        }
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
                const data = JSON.parse(lastMessage.data);
                const cntx = contextRef.current;
                const canvas = canvasRef.current;

                switch (data.type) {
                    case 'room_list':
                        setAvailableRooms(data.payload.rooms || []);
                        break;
                    case 'room_state':
                        setCurrentRoom(data.room);

                        cntx.clearRect(0, 0, canvas!.width, canvas!.height);
                        if (data.payload.history) {
                            data.payload.history.forEach((actionStr: string) => {
                                const action: DrawPayload = JSON.parse(actionStr);
                                cntx.beginPath()
                                cntx.strokeStyle = action.color;
                                cntx.lineWidth = action.lineWidth;
                                cntx.moveTo(action.prevX, action.prevY);
                                cntx.lineTo(action.currentX, action.currentY);
                                cntx.stroke();
                                cntx.closePath();
                            });
                        }
                        sendMessage(JSON.stringify({type: "get_rooms"}));
                        break;
                    case 'draw_update':
                        const drawData: DrawPayload = data.payload;
                        cntx.beginPath();
                        cntx.strokeStyle = drawData.color;
                        cntx.lineWidth = drawData.lineWidth;
                        cntx.moveTo(drawData.prevX, drawData.prevY);
                        cntx.lineTo(drawData.currentX, drawData.currentY);
                        cntx.stroke();
                        cntx.closePath();
                        break;
                    case 'error':
                    case 'room_full':
                        alert(`Server: ${data.payload.message || 'Room is full'}`);
                        setCurrentRoom('lobby');
                        break;
                } 

            } catch (errr) {
                console.error('Error parsing WS message: ', errr);
            }
        }
    }, [lastMessage, sendMessage]);

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
        if (currentRoom === 'lobby') return alert('Join or create a room first');
        const coords = getCoordinates(ev);
        if (!coords) return;
        isDrawingRef.current = true;
        lastCoordinatesRef.current = coords;
    };

    const stopDrawing = () => {
        isDrawingRef.current = false;
        lastCoordinatesRef.current = null;
    };


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
            sendMessage(JSON.stringify({
                type: 'draw',
                room: currentRoom,
                payload: payload
            }));

            lastCoordinatesRef.current = coords;
            lastEmitTimeRef.current = now;
        }
    };

    const handleCreateRoom = (ev: React.SubmitEvent<HTMLFormElement>) => {
        ev.preventDefault();
        const roomName = newRoomName.trim().toLowerCase();
        if (!roomName) return;

        sendMessage(JSON.stringify({
            type: 'create_room',
            room: roomName,
            capacity: newRoomCapacity <= 50 ? newRoomCapacity:50,
        }));

        setCurrentRoom(roomName);
        setNewRoomName('');
    }

    const handleRoomSwitch = (ev: React.SubmitEvent<HTMLFormElement>) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        const input = form.elements.namedItem('roomInput') as HTMLInputElement;

        if (input && input.value.trim()) {
            const roomName = input.value.trim().toLowerCase();

            if (contextRef.current && canvasRef.current) {
                contextRef.current.clearRect(0, 0, canvasRef.current.width,  canvasRef.current.height);
            }

            setCurrentRoom(roomName);
            sendMessage(JSON.stringify({type: 'join_room', room: roomName }));
            input.value = '';
        }
    };

    const isFull = (room: RoomInfo) => room.users >= room.maxCapacity;

    return (
        <div style = {{padding: '20px', fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto'}}>
            <h2>DRAWALIVE</h2>

            {/* status bar*/}

            <div style={{display: 'flex', gap: '20px', marginBottom: '15px', alignItems: 'center', background: '#111', padding: '12px', borderRadius: '6px', color: '#fff' }}>
                <div>
                    Status: {readyState === 1 ? <span style={{ color: '#4caf50' }}>● Connected</span> : <span style={{ color: '#f44336' }}>○ Offline</span>}
                </div>
                <div style={{marginLeft: 'auto'}}>
                    Current Room: <strong style={{color: '#0070f3'}}>{currentRoom == "lobby" ? 'Lobby': currentRoom}</strong>
                </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px'}}>
                {/*CreateRoom*/}
                <div style = {{background: '#f5f5f5', padding: '15px', borderRadius: '6px'}}>
                    <h4 style={{marginTop: 0}}>Create New Room</h4>
                    <form onSubmit={handleCreateRoom} style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                        <input
                            type='text'
                            placeholder="Room Name (e.g., art room)" 
                            value={newRoomName}
                            onChange={(ev) => setNewRoomName(ev.target.value)}
                            style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc'}}
                        />
                        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                            <label style={{fontSize: '14px'}}>Max Capacity: </label>
                           <input
                            type='number'
                            min="2"
                            max='50'
                            value={newRoomCapacity}
                            onChange={(ev) => setNewRoomCapacity(Number(ev.target.value))}
                            style={{width: '60px', padding: '6px', borderRadius: '4px', border: '1px solid #ccc'}}
                           />
                            <button type='submit' style={{padding: '8px 16px', cursor: 'pointer', background: '#0070f3', color: 'white', border: 'none', borderRadius: '4px', marginLeft: 'auto'}}>
                                Create & Join
                            </button>
                        </div> 
                    </form>
                </div>

                {/* Join Room feature*/}
                <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '6px'}}>
                    <h4 style={{marginTop: 0}}>Join Existing Room</h4>
                    <form onSubmit={handleRoomSwitch} style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                        <input
                            name="roomInput"
                            type='text'
                            placeholder="Enter Room Name"
                            style={{padding: '8px', borderRadius: '4px', border: '1px solid #ccc'}}
                        />
                        <button type='submit' style={{padding: '8px 16px', cursor: 'pointer', background: '#4caf50', color: 'white', border: 'none', borderRadius: '4px'}}>
                            Join Room
                        </button>
                    </form>
                </div>
            </div>

            <div style={{marginBottom: '20px'}}>
                <h4>Available Rooms</h4>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px'}}>
                    {availableRooms.length === 0 ? (
                        <p style={{color: '#666'}}>No rooms are available. Create one instead!</p>
                    ) : (
                        availableRooms.map((room) => (
                            <div key={room.name} style={{
                                background: isFull(room)? '#ffebee': '#e3f2fd',
                                padding: '10px 15px',
                                borderRadius: '6px',
                                border: `1px sold ${isFull(room) ? '#ffcdd2': '#bbdefb'}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '5px',
                                minWidth: '150px'
                            }}>
                                <div style={{fontWeight: 'bold', textTransform: 'capitalize'}}>{room.name}</div>
                                <div style={{fontSize: '12px', color:'#555'}}>
                                    {room.users} / {room.maxCapacity} users
                                </div>
                                <div style={{fontSize: '12px', color: '#888'}}>
                                    Expires in: {room.expiresIn}
                                </div>

                                <button
                                    onClick={() => {
                                        if (contextRef.current && canvasRef.current) {
                                            contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                                        }
                                        setCurrentRoom(room.name)
                                        sendMessage(JSON.stringify({type: 'join_room', room: room.name}));
                                    }}
                                    disabled={isFull(room)}
                                    style={{
                                        padding: '6px 12px',
                                        cursor: isFull(room) ? 'not-allowed' : 'pointer',
                                        background: isFull(room) ? '#ccc' : '#0070f3',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        marginTop: '5px'
                                    }}
                                >
                                    {isFull(room) ? 'Full' : 'Join'}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>  

            {/* Canvas and brush*/} 

            <div style={{display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center'}}>
                    <div style={{display:'flex', gap: '20px', alignItems: 'center', background: '#f5f5f5', padding: '10px 20px', borderRadius: '6px', flexWrap: 'wrap'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                            <label>Color: </label>
                            <input
                                type="color"
                                value={brushColour}
                                onChange={(ev) => setBrushColour(ev.target.value)}
                                style={{cursor: 'pointer', border: 'none', width: '40px', height:'30px'}}
                            />
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                            <label>Width:</label>
                            <input
                                type="range"
                                min="1"
                                max="50"
                                value={brushWidth}
                                onChange={(ev) => setBrushWidth(Number(ev.target.value))}
                            />
                            <span style={{minWidth: '30px'}}>{brushWidth}</span>
                        </div>
                        <button
                                onClick={() => {
                                    if (contextRef.current && canvasRef.current) {
                                        contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                                    }
                                }}
                                style={{padding: '6px 12px', cursor: 'point', background: '#f44336', color: 'white', border: 'none', borderRadius: '4px', marginLeft: 'auto'}}
                        >
                            Clear Canvas
                        </button>
                    </div>

                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onMouseMove={draw}
                        style={{
                            border: '2px solid #333',
                            borderRadius: '4px',
                            cursor: currentRoom === 'lobby' ? 'not-allowed' : 'crosshair',
                            background: '#fff',
                            touchAction: 'none'
                        }}
                    />
            </div>
        </div>
    );
}