package main

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	// allowing all origins rn for development
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type ClientMessage struct {
	Type string `json:"type"`
	Room string `json:"room"`
	Capacity int `json:"capacity"`
	Payload json.RawMessage `json:"payload"`
}

type ServerMessage struct {
	Type string `json:"type"`
	Room string `json:"room"`
	Payload interface{} `json:"payload"`
}

type RoomInfo struct {
	Name string `json:"name"`
	Users int `json:"users"`
	MaxCapacity int `json:"maxCapacity"`
	ExpiresIn string `json:"expiresIn"`
}

type Room struct {
	Name string
	MaxCapacity int
	ExpiresAt time.Time
	History []string
	Clients map[*Client]bool
	mu sync.Mutex
}

type Client struct {
	conn *websocket.Conn
	room string
	send chan []byte
}


type Hub struct {
	rooms map[string]*Room
	messages chan ClientMessage
	register chan *Client
	unregister chan *Client
	mu sync.Mutex
}

func newHub() *Hub {
	newHub := &Hub{
		rooms: make(map[string]*Room),
		messages: make(chan ClientMessage),
		register: make(chan *Client),
		unregister: make(chan *Client),
	}
	go h.cleanupRoutine()
	return newHub
}

func (h *Hub) cleanupRoutine() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		h.mu.Lock()
		now := time.Now()

		for name, room := range h.rooms {
			if now.After(room.ExpiresAt) {
				log.Printf("Room '%s' expired and was deleted.", name)

				for client := range room.Clients {
					close(client.send)
					client.conn.Close()
				}
				delete(h.rooms, name)
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) run() {
	for {
		select {
		case client  := <- h.register:
			h.mu.Lock()
			room := h.rooms[client.room]
			if room == nil {
				h.mu.Unlock()
				client.send <- h.buildServerMsg("error", client.room, map[string]string{"message": "Room does not exist"})
				close(client.send)
				client.conn.Close()
				continue
			}

			room.mu.Lock()
			if len(room.Clients) >= room.MaxCapacity {
				room.mu.Unlock()
				h.mu.Unlock()
				client.send <- h.buildServerMsg("room_full", client.room, nil)
				close(client.send)
				client.conn.Close()
				continue
			}

			room.Clients[client] = true
			historyCopy := make([]string, len(room.History))
			room.mu.Unlock()
			h.mu.Unlock()

			client.send <- h.buildServerMsg("room_state", client.room, map[string]interface{}{"history": historyCopy})
		
		case client := <-h.unregister:
			h.mu.Lock()
			if room, ok := h.rooms[client.room]; ok {
				room.mu.Lock()
				delete(room.Clients, client)
				room.mu.Unlock()
				close(client.send)
			}
		
		case message := <-h.messages:
			h.mu.Lock()
			room := h.rooms[msg.Room]
			h.mu.Unlock()

			if room == nil {
				continue
			}

			if msg.Type == "draw" {
				room.mu.Lock()
				room.History = append(room.History, string(msg.Payload))

				for client := range room.Clients {
					select {
					case client.send <- h.buildServerMsg("draw_update", msg.Room, msg.Payload):
					default:
						close(client.send)
						delete(room.Clients, client)
					}
				}

				room.Mu.Unlock()
			}
		}
	}
}

func (h *Hub) buildServerMsg(msgType, room string, payload interface{}) []byte {
	msg: = ServerMessage{Type: msgType, Room: room, Payload: payload}
	b, _ := json.Marshal(msg)
	return b
}

func (h *Hub) handleListRooms(client *Client) {
	h.mu.Lock()
	var rooms []RoomInfo
	for _, room := range h.rooms {
		room.mu.Lock()
		rooms = append(rooms, RoomInfo{
			Name: room.Name,
			Users: len(room.Clients),
			MaxCapacity: room.MaxCapacity,
			ExpiresIn: time.Until(room.ExpiresAt).Round(time.Minute).String(),
		})
		room.mu.Unlock()
	}
	h.mu.Unlock()

	client.send <- h.buildServerMsg("room_list", map[string]interface{}{"rooms": rooms})
}

func (h* Hub) handleCreateRoom(client *Client, msg ClientMessage) {
	if msg.Room == "" || msg.Capacity <= 0 {
		client.send <- h.buildServerMsg("error", map[string]string{"message": "Invalid room name or capacity"})
		return
	}

	h.mu.Lock()
	if _, exists := h.rooms[msg.Room]; exists {
		h.mu.Unlock()
		client.send <- h.buildServerMsg("error", msg.Room, map[string]string{"message": "Room already exists"})
		return
	}

	newRoom := &Room{
		Name: msg.Room,
		MaxCapacity: msg.Capacity,
		ExpiresAt: time.Now().Add(1 * time.Hour),
		History: []string{},
		Clients: make(map[*Client]bool),
	}
	
	h.rooms[msg.Room] = newRoom
	h.mu.Unlock()

	client.room = msg.Room
	h.register <- client
}

func handleConnections(hub *Hub, w http.ResponseWriter, r *http.Request) {
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	client := &Client{conn: connection, room: "lobby", send: make(chan []byte, 256)}

	go func() {
		defer func() {
			if client.room != "lobby" {
				hub.unregister <- client
			}
			connection.Close()
		}()

		for {
			_, messageBytes, err := connection.ReadMessage()
			if err != nil {
				break
			}
			var msg ClientMessage
			if err := json.Unmarshal(messageBytes, &msg); err != nil {
				continue
			}

			switch msg.Type {
			case "get_rooms":
				hub.handleListRooms(client)
			case "create_room":
				hub.handleCreateRoom(client, msg)
			case "join_room":
				client.room = msg.Room
				hub.register <- client
			case "draw":
				hub.messages <- msg
			}
		}
	}()

	go func() {
		for messageBytes := range client.send {
			connection.WriteMessage(websocket.TextMessage, messageBytes)
		}
	}()
}

func main() {
	hub := newHub()

	go hub.run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleConnections(hub, w, r)
	})

	log.Println("Message Server on port :8000")
	log.Fatal(http.ListenAndServe(":8000", nil))
}
