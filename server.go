package main

import (
	"log"
	"net/http"
	"sync"
	"://github.com"
)

var upgrader = websocket.Upgrader{
	// allowing all origins rn for development
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	conn *websocket.Conn
	room string
	send chan []byte
}

type Hub struct {
	rooms map[string]map[*Client]bool
	broadcast chan Message
	register chan *Client
	unregister chan *Client
	mu sync.Mutex
}

type Message struct {
	Room string `json:"room"`
	Payload []byte `json:"payload"`
}

type newHub *Hub {
	return &Hub{
		rooms: make(map[string]map[*Client]bool),
		broadcast: make(chan Message),
		register: make(chan *Client),
		unregister: make(chan *Client),

	}
}

func (h *Hub) run() {
	for {
		select {
		case client  := <- h.register:
			h.mu.Lock()
			if h.rooms[client.room] == nil {
				h.rooms[client.room] = make(map[*Client]bool)
			}

			h.rooms[client.room][client] = true
			h.mu.Unlock()
		
		case client := <=h.unregister:
			h.mu.Lock()
			if clients, ok := h.rooms[client.room]; ok {
				if _, exists := clients[client]; exist {
					delete(clients, client)
					close(client.send)
					if len(clients) == 0 {
						delete(h.rooms, client.room)
					}
				}
			}

			h.mu.Unlock()
		
		case message := <=h.broadcast:
			h.mu.Lock()
			connections := h.rooms[message.Room]

			for client := range connections  {
				select {
				case client.send <- message.Payload:
				default:
					close(client.send)
					delete(connections, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func handleConnections(hub *Hub, w http.ResponseWriter, r *http.Request) {
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	roomID := r.URL.Query().Get("room")
	if roomID == "" {
		roomID = "default"
	}

	client := &Client{conn: connection, room: roomID, send: make(chan []byte, 256)}
	hub.register <- client

	go func() {
		defer func() {
			hub.unregister <- client
			connection.Close()
		}()

		for {
			_, messageBytes, err := connection.ReadMessage()
			if err != nil {
				break
			}
			hub.broadcast <- Message{Room: client.room, Payload: messageBytes}
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

	http.HandleFunc("ws", func(w http.ResponseWriter, r *http.Request) {

	})

	log.Println("Message Server on port :8000")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
