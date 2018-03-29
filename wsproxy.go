package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var wsupgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func wsToTCP(wsConn *websocket.Conn, tcpConn net.Conn) chan error {
	done := make(chan error, 2)
	go func() {
		defer wsConn.Close()
		defer tcpConn.Close()
		for {
			t, m, err := wsConn.ReadMessage()
			if err != nil {
				done <- err
				return
			}
			if t == websocket.BinaryMessage {
				log.Printf("message type:%v size:%v", m[0], len(m))
				err = binary.Write(tcpConn, binary.BigEndian, uint32(len(m)))
				if err != nil {
					done <- err
					return
				}
				_, err = tcpConn.Write(m)
				if err != nil {
					done <- err
					return
				}
			} else {
				log.Println("invalid message", t, m)
			}
		}
		done <- nil
	}()
	return done
}

func tcpToWs(tcpConn net.Conn, wsConn *websocket.Conn) chan error {
	done := make(chan error, 2)
	go func() {
		defer wsConn.Close()
		defer tcpConn.Close()
		for {
			var l uint32
			err := binary.Read(tcpConn, binary.BigEndian, &l)
			if err != nil {
				done <- err
				return
			}
			data := make([]byte, l, l)
			_, err = tcpConn.Read(data)
			if err != nil {
				done <- err
				return
			}
			err = wsConn.WriteMessage(websocket.BinaryMessage, data)
			if err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	return done
}

func streamWsHandler(target, streamName string, w http.ResponseWriter, r *http.Request) {
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("Failed to set websocket upgrade: %+v", err)
		return
	}
	defer conn.Close()

	var data map[string]interface{}
	err = conn.ReadJSON(&data)
	if err != nil {
		log.Println("readjson", err)
		return
	}
	log.Println("connect: ", data)

	conn2, err := net.Dial("tcp", target)
	if err != nil {
		log.Println("connect tcp", err)
		conn.WriteJSON(map[string]interface{}{"error": "connect failed"})
		return
	}
	defer conn2.Close()

	done1 := tcpToWs(conn2, conn)
	done2 := wsToTCP(conn, conn2)

	// wait
	log.Println("done2", <-done2)
	log.Println("done1", <-done1)
	log.Println("disconnect")
}

func wsURL(r *http.Request, path string) string {
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		return "ws://" + r.Host + path
	}
	return "wss://" + r.Host + path
}

func initHttpd(target string) *gin.Engine {
	r := gin.Default()

	r.GET("/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"_status": 200, "message": "It works!"})
	})

	r.Use(static.Serve("/", static.LocalFile("./static", false)))
	r.GET("/", func(c *gin.Context) {
		c.File("./static/index.html")
	})

	// proxy
	r.GET("/stream/:stream", func(c *gin.Context) {
		streamWsHandler(target, c.Param("stream"), c.Writer, c.Request)
	})

	// hub
	r.GET("/stream/:stream/publish", func(c *gin.Context) {
		publishWsHandler(c.Param("stream"), c.Writer, c.Request)
	})
	r.GET("/stream/:stream/subscribe", func(c *gin.Context) {
		subscribeWsHandler(c.Param("stream"), c.Writer, c.Request)
	})

	return r
}

func main() {
	listenPort := flag.Int("p", 8080, "http listen port")
	target := flag.String("t", "127.0.0.1:2500", "target")
	flag.Parse()
	gin.SetMode(gin.ReleaseMode)
	log.Printf("start server. port: %d", *listenPort)
	initHttpd(*target).Run(":" + fmt.Sprint(*listenPort))
}
