package main

// TODO: refactoring
import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strconv"

	"github.com/gorilla/websocket"
)

type Stream struct {
	Name       string
	Owner      string
	ConnectURL string
	event      chan *streamEvent
	cmd        chan string // chan *Cmd
	stream     chan []byte
}

type Subscriber struct {
	id     string
	stream chan<- []byte
}

type streamEvent struct {
	action string
	client *Subscriber
	value  string
}

var streams = map[string]*Stream{}

func NewStream(owner, name, wsurl string, conn *websocket.Conn) *Stream {
	v := &Stream{Owner: owner, Name: name, ConnectURL: wsurl, event: make(chan *streamEvent), stream: make(chan []byte, 100)}
	log.Printf("NewVolume %s %s", owner, name)
	streams[v.StreamName()] = v // TODO: lock
	go streamLoop(v, conn)
	return v
}

func (v *Stream) StreamName() string {
	return v.Name
}

func (v *Stream) Dispose() {
	log.Println("dispose", v.StreamName())
	delete(streams, v.StreamName()) // TODO: lock
	v.cmd <- "close"
}

func (v *Stream) NewProxyConnection(id string) {
	v.event <- &streamEvent{"join", &Subscriber{}, id}
}

func streamLoop(v *Stream, conn *websocket.Conn) {
	subscribers := map[string]*Subscriber{}
	var streamConfiguration []byte
	for {
		select {
		case _ = <-v.cmd:
			return
		case data := <-v.stream:
			log.Println("publish size:", len(data), len(subscribers))
			if data[0] == 2 {
				log.Println("set configuration.")
				streamConfiguration = data
			}
			for _, s := range subscribers {
				s.stream <- data
			}
		case ev := <-v.event:
			fmt.Println(ev.action)
			if ev.action == "join" {
				subscribers[ev.client.id] = ev.client
				if streamConfiguration != nil {
					ev.client.stream <- streamConfiguration
				}
			}
			if ev.action == "leave" {
				delete(subscribers, ev.client.id)
			}
		}
	}
}

func publishWsHandler(streamName string, w http.ResponseWriter, r *http.Request) {
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("Failed to set websocket upgrade: %+v", err)
		return
	}

	// receive connect message.
	var data map[string]string
	err = conn.ReadJSON(&data)
	if err != nil {
		log.Println("ReadMessage", err)
		return
	}
	log.Println("publishWsHandler", data)

	// TODO: overwrite if same owner
	v := NewStream(data["user"], streamName, "", conn)
	defer v.Dispose()

	for {
		t, data, err := conn.ReadMessage()
		if err != nil {
			log.Println("ReadMessage", err)
			break
		}
		if t == websocket.BinaryMessage {
			v.stream <- data
		} else {
			log.Println("unknown message:", data)
		}
	}
	log.Println("disconnect publisher")
}

func subscribeWsHandler(streamName string, w http.ResponseWriter, r *http.Request) {
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	// receive connect message.
	var data map[string]string
	err = conn.ReadJSON(&data)
	if err != nil {
		log.Println("ReadMessage", err)
		return
	}
	log.Println("subscribeWsHandler", data)

	if v, ok := streams[streamName]; ok {
		cid := strconv.FormatUint(rand.Uint64(), 36)
		stream := make(chan []byte, 10)
		subscriber := &Subscriber{id: cid, stream: stream}
		v.event <- &streamEvent{"join", subscriber, "name"}
		defer func() {
			v.event <- &streamEvent{"leave", subscriber, "name"}
		}()

		for {
			select {
			case data := <-stream:
				err = conn.WriteMessage(websocket.BinaryMessage, data)
				if err != nil {
					return
				}
			}
		}
	}
	log.Println("disconnect subscriber")
}
